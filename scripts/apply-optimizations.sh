#!/bin/bash
# Run from the repo root so npm finds package.json.
cd "$(dirname "$0")/.."

echo "🚀 Applying Database Performance Optimizations..."
echo ""

# Run the optimization script
echo "📊 Adding database indexes..."
npm run optimize-db

echo ""
echo "✅ Optimization complete!"
echo ""
echo "📝 Next steps:"
echo "1. Restart your server: npm start"
echo "2. Clear browser cache and reload the app"
echo "3. Check docs/archive/performance/PERFORMANCE_OPTIMIZATION.md for details"
