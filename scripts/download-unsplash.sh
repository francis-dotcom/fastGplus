#!/usr/bin/env bash
# Download all Unsplash images used in programs (and about hero) to images/unsplash
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$DIR/images/unsplash"
mkdir -p "$OUT"

# Unique Unsplash URLs used in programs.html and about.html (w=400 for cards, w=1200 for hero)
URLS=(
  "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=400&q=80"
  "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=400&q=80"
  "https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=400&q=80"
  "https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=400&q=80"
  "https://images.unsplash.com/photo-1509228468518-180dd486490e?w=400&q=80"
  "https://images.unsplash.com/photo-1517976487492-5750f3195933?w=400&q=80"
  "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&q=80"
  "https://images.unsplash.com/photo-1542810634-71277d95dcbb?w=400&q=80"
  "https://images.unsplash.com/photo-1519781542704-957ff19eff00?w=400&q=80"
  "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400&q=80"
  "https://images.unsplash.com/photo-1505664194779-8beaceb93744?w=400&q=80"
  "https://images.unsplash.com/photo-1523050853064-dbad350e0225?w=400&q=80"
  "https://images.unsplash.com/photo-1584036561566-baf8f1f1b144?w=400&q=80"
  "https://images.unsplash.com/photo-1576086213369-97a306d36557?w=400&q=80"
  "https://images.unsplash.com/photo-1603126857599-f6e157fa2fe6?w=400&q=80"
  "https://images.unsplash.com/photo-1635372722656-389f87a941b7?w=400&q=80"
  "https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?w=400&q=80"
  "https://images.unsplash.com/photo-1518186285589-2f7649de83e0?w=400&q=80"
  "https://images.unsplash.com/photo-1453733190371-0a9bedd82893?w=400&q=80"
  "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&q=80"
  "https://images.unsplash.com/photo-1454165833767-131438967469?w=400&q=80"
  "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=400&q=80"
  "https://images.unsplash.com/photo-1551816230-ef5deaed4a26?w=400&q=80"
  "https://images.unsplash.com/photo-1589330664650-8dc444efecbe?w=400&q=80"
  "https://images.unsplash.com/photo-1523301343968-6a6ebf63c672?w=400&q=80"
  "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&q=80"
)
# About page hero (w=1200) - same photo id as yoruba-crs
# photo-1523050853064-dbad350e0225 already in URLS

for url in "${URLS[@]}"; do
  # Extract photo id: photo-1559839734-2b71ea197ec2 -> 1559839734-2b71ea197ec2
  id=$(echo "$url" | sed -n 's/.*photo-\([^?]*\).*/\1/p')
  [ -z "$id" ] && continue
  outfile="$OUT/${id}.jpg"
  if [ -f "$outfile" ]; then
    echo "Skip (exists): $id.jpg"
  else
    echo "Downloading: $id.jpg"
    curl -sSL -o "$outfile" "$url" || echo "  (failed, will keep remote URL)"
  fi
done
echo "Done. Files in $OUT"
