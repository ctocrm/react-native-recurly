#!/bin/bash
lsof -ti:8081 | xargs -r kill -9 2>/dev/null
sleep 2
script -q -f -c "npx expo start --clear" /home/d/Desktop/jsmastery/bundle.log
