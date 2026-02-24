import { useEffect, useState } from 'react';
import { API_KEY } from '../lib/api';

// Resolve API base from env or current origin so we never hard-code backend host
const API_BASE = (() => {
    const envUrl = import.meta.env.VITE_API_URL;

    try {
        const resolved = envUrl ? new URL(envUrl, window.location.origin).toString() : `${window.location.origin}/api`;
        return resolved.replace(/\/$/, '');
    } catch (err) {
        console.error('Failed to resolve API base URL, falling back to /api', err);
        return `${window.location.origin}/api`;
    }
})();

type ViewMode = 'swagger' | 'redoc';

export default function ApiDocs() {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [docsHtml, setDocsHtml] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('swagger');

    const fetchDocs = async () => {
        setIsLoading(true);
        setError(null);
        setDocsHtml(null);

        try {
            if (viewMode === 'swagger') {
                // Fetch the Swagger UI HTML with API key
                const response = await fetch(`${API_BASE}/docs`, {
                    headers: {
                        'X-API-Key': API_KEY,
                    },
                });

                if (!response.ok) {
                    throw new Error(`Failed to load docs: ${response.status} ${response.statusText}`);
                }

                let html = await response.text();

                // Modify the HTML to include API key in all requests
                const apiKeyScript = `
                    <script>
                        // Wait for Swagger UI to load
                        window.addEventListener('load', function() {
                            setTimeout(function() {
                                // Try to set the API key in Swagger UI
                                if (window.ui) {
                                    window.ui.preauthorizeApiKey('X-API-Key', '${API_KEY}');
                                }
                            }, 1000);
                        });
                    </script>
                `;

                // Insert our script before closing body tag
                html = html.replace('</body>', apiKeyScript + '</body>');

                // Fix relative URLs to point to backend
                html = html.replace(/href="\/([^"]+)"/g, `href="${API_BASE}/$1"`);
                html = html.replace(/src="\/([^"]+)"/g, `src="${API_BASE}/$1"`);

                // Fix the openapi.json URL to include API key as query param
                // Since we can't add headers to static resource loads in basic Swagger iframe
                html = html.replace(
                    /url:\s*['"]([^'"]*openapi\.json)['"]/g,
                    `url: '${API_BASE}/openapi.json', requestInterceptor: (req) => { req.headers['X-API-Key'] = '${API_KEY}'; return req; }`
                );

                setDocsHtml(html);
            } else {
                // Redoc Implementation
                // 1. Fetch the OpenAPI Spec content authenticated
                const specResponse = await fetch(`${API_BASE}/openapi.json`, {
                    headers: { 'X-API-Key': API_KEY }
                });
                
                if (!specResponse.ok) {
                    throw new Error(`Failed to load OpenAPI spec: ${specResponse.status}`);
                }
                
                const specData = await specResponse.json();

                // 2. Fetch the Redoc HTML template
                const htmlResponse = await fetch(`${API_BASE}/redoc`, {
                    headers: { 'X-API-Key': API_KEY }
                });

                if (!htmlResponse.ok) {
                    throw new Error(`Failed to load Redoc: ${htmlResponse.status}`);
                }

                let html = await htmlResponse.text();

                // 3. Fix relative URLs
                html = html.replace(/href="\/([^"]+)"/g, `href="${API_BASE}/$1"`);
                html = html.replace(/src="\/([^"]+)"/g, `src="${API_BASE}/$1"`);

                // 4. Inject the spec directly and initialize Redoc
                // FastAPI's Redoc template uses a <redoc> tag. We want to take control.
                // We'll replace the existing <redoc> tag (and potentially the script that inits it if it's auto-init)
                // with our own container and initialization script.
                
                // Remove existing redoc tag
                html = html.replace(/<redoc[^>]*><\/redoc>/g, '<div id="redoc-container"></div>');
                
                // Create our initialization script
                const initScript = `
                    <script>
                        const spec = ${JSON.stringify(specData)};
                        window.addEventListener('load', function() {
                            if (window.Redoc) {
                                Redoc.init(spec, {
                                    scrollYOffset: 50
                                }, document.getElementById('redoc-container'));
                            }
                        });
                    </script>
                `;
                
                html = html.replace('</body>', initScript + '</body>');
                
                setDocsHtml(html);
            }
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : 'Failed to load API documentation');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchDocs();
    }, [viewMode]);

    return (
        <div className="h-[var(--page-content-height)] flex flex-col">
            {/* Header */}
            <div className="mb-2 flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">API Documentation</h1>
                
                <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                    <button
                        onClick={() => setViewMode('swagger')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                            viewMode === 'swagger'
                                ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                        }`}
                    >
                        Swagger
                    </button>
                    <button
                        onClick={() => setViewMode('redoc')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                            viewMode === 'redoc'
                                ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                        }`}
                    >
                        Redoc
                    </button>
                </div>
            </div>

            {/* Content - flex-1 to fill remaining space */}
            {/* Force light mode for iframe since Swagger UI doesn't support dark mode well */}
            <div className="flex-1 min-h-0 bg-white rounded-lg border border-gray-200 overflow-hidden relative">
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
                        <div className="flex flex-col items-center gap-4">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
                            <p className="text-gray-600">Loading {viewMode === 'swagger' ? 'Swagger UI' : 'Redoc'}...</p>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="flex items-center justify-center h-full">
                        <div className="flex flex-col items-center gap-4 text-center p-8">
                            <div className="text-red-500 text-6xl">⚠️</div>
                            <h2 className="text-xl font-semibold text-gray-900">Failed to Load Documentation</h2>
                            <p className="text-gray-600 max-w-md">{error}</p>
                            <button
                                onClick={fetchDocs}
                                className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
                            >
                                Try Again
                            </button>
                        </div>
                    </div>
                )}

                {!error && docsHtml && (
                    <iframe
                        srcDoc={docsHtml}
                        className="w-full h-full border-0"
                        title="API Documentation"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    />
                )}
            </div>
        </div>
    );
}
