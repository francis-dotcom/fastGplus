#!/usr/bin/env python3
"""
Extract specific endpoints and models from OpenAPI JSON and generate YAML.

This script extracts:
- Auth endpoints (users)
- Tables endpoints
- Storage buckets endpoints
- Storage files endpoints
- Realtime endpoints
- All referenced models and schemas
"""

import json
import yaml
from pathlib import Path
from typing import Dict, Set, Any, List


def load_openapi_json(file_path: str) -> Dict[str, Any]:
    """Load OpenAPI JSON file."""
    with open(file_path, 'r') as f:
        return json.load(f)


def get_models_from_endpoint(endpoint: Dict[str, Any]) -> Set[str]:
    """Extract model references from an endpoint."""
    models = set()
    
    def extract_refs(obj):
        if isinstance(obj, dict):
            if '$ref' in obj:
                # Extract model name from reference like #/components/schemas/UserRead
                ref = obj['$ref']
                if '/schemas/' in ref:
                    models.add(ref.split('/')[-1])
            for value in obj.values():
                extract_refs(value)
        elif isinstance(obj, list):
            for item in obj:
                extract_refs(item)
    
    extract_refs(endpoint)
    return models


def collect_all_referenced_models(models: Dict[str, Any], initial_models: Set[str]) -> Dict[str, Any]:
    """Recursively collect all models referenced by the initial set of models."""
    result = {}
    visited = set()
    to_process = list(initial_models)
    
    while to_process:
        model_name = to_process.pop(0)
        if model_name in visited or model_name not in models:
            continue
        
        visited.add(model_name)
        model = models[model_name]
        result[model_name] = model
        
        # Find referenced models
        refs = set()
        
        def extract_refs(obj):
            if isinstance(obj, dict):
                if '$ref' in obj:
                    ref = obj['$ref']
                    if '/schemas/' in ref:
                        ref_model = ref.split('/')[-1]
                        if ref_model not in visited:
                            refs.add(ref_model)
                for value in obj.values():
                    extract_refs(value)
            elif isinstance(obj, list):
                for item in obj:
                    extract_refs(item)
        
        extract_refs(model)
        to_process.extend(refs)
    
    return result


def extract_endpoints_by_tags(openapi: Dict[str, Any], tags: List[str]) -> tuple[Dict[str, Any], Set[str]]:
    """
    Extract endpoints matching specific tags.
    
    Returns:
        Tuple of (filtered_paths, referenced_models_set)
    """
    paths = openapi.get('paths', {})
    filtered_paths = {}
    all_models = set()
    
    for path, path_item in paths.items():
        for method, operation in path_item.items():
            if method in ['parameters', 'servers']:  # Skip non-operation keys
                continue
            
            if isinstance(operation, dict) and 'tags' in operation:
                operation_tags = operation.get('tags', [])
                if any(tag in tags for tag in operation_tags):
                    if path not in filtered_paths:
                        filtered_paths[path] = {}
                    filtered_paths[path][method] = operation
                    
                    # Collect referenced models from this endpoint
                    models = get_models_from_endpoint(operation)
                    all_models.update(models)
    
    return filtered_paths, all_models


def create_openapi_yaml(
    original_openapi: Dict[str, Any],
    filtered_paths: Dict[str, Any],
    filtered_models: Dict[str, Any]
) -> Dict[str, Any]:
    """Create a new OpenAPI document with filtered endpoints and models."""
    
    return {
        'openapi': original_openapi.get('openapi', '3.1.0'),
        'info': original_openapi.get('info', {}),
        'paths': filtered_paths,
        'components': {
            'schemas': filtered_models,
            'securitySchemes': original_openapi.get('components', {}).get('securitySchemes', {})
        }
    }


def main():
    """Main execution function."""
    # Define paths
    input_file = 'openapi.json'
    output_file = 'openapi_extracted.yaml'
    
    # Load original OpenAPI
    print(f"Loading {input_file}...")
    openapi = load_openapi_json(input_file)
    
    # Tags to extract
    tags = [
        'users',           # Auth endpoints
        'tables',          # Tables endpoints
        'storage-buckets', # Buckets endpoints
        'storage-files',   # Files endpoints
        'realtime'         # Realtime endpoints
    ]
    
    print(f"Extracting endpoints with tags: {tags}")
    filtered_paths, referenced_models = extract_endpoints_by_tags(openapi, tags)
    
    print(f"Found {len(filtered_paths)} paths with {len(referenced_models)} referenced models")
    
    # Collect all models recursively (including models referenced by models)
    print("Collecting all referenced models...")
    all_models = openapi.get('components', {}).get('schemas', {})
    filtered_models = collect_all_referenced_models(all_models, referenced_models)
    
    print(f"Total models to include: {len(filtered_models)}")
    
    # Create new OpenAPI document
    print("Creating filtered OpenAPI document...")
    filtered_openapi = create_openapi_yaml(openapi, filtered_paths, filtered_models)
    
    # Write to YAML
    print(f"Writing to {output_file}...")
    with open(output_file, 'w') as f:
        yaml.dump(
            filtered_openapi,
            f,
            default_flow_style=False,
            sort_keys=False,
            allow_unicode=True
        )
    
    print(f"\n✅ Successfully created {output_file}")
    print(f"   - Endpoints: {len(filtered_paths)}")
    print(f"   - Models: {len(filtered_models)}")
    print(f"\nExtracted tags: {', '.join(tags)}")


if __name__ == '__main__':
    main()
