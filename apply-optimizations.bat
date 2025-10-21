@echo off
echo 🚀 Applying Database Performance Optimizations...
echo.

REM Run the optimization script
echo 📊 Adding database indexes...
call npm run optimize-db

echo.
echo ✅ Optimization complete!
echo.
echo 📝 Next steps:
echo 1. Restart your server: npm start
echo 2. Clear browser cache and reload the app
echo 3. Check PERFORMANCE_OPTIMIZATION.md for details
echo.
pause
