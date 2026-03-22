
# start server
pnpm dev

# clear screen
clear

# elevate PS to admin
Set-ExecutionPolicy RemoteSigned


# find already runnong process
netstat -ano | findstr :54329

# kill already runninf process
taskkill /F /PID 12345
taskkill /F /IM postgres.exe /T

# kill zombie database
taskkill /F /IM postgres.exe/


$env:GEMINI_API_KEY="AIzaSyBym7joF09uBqYYHhkf3d0yzF3ghQcSDAM"; pnpm dev