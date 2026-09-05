proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $http_host;
# Both live channels ride WebSocket, and the terminal must not be buffered — the same two things
# the deployment README asks of any proxy put in front of this stack.
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_buffering off;
# Request bodies too, and for a reason: the debug build's dwds channel is a stream of tiny POSTs, and
# holding them here is enough to deliver them out of order — which shows up as "Message received out
# of order" and then a run that hangs forever with no error at all.
proxy_request_buffering off;
proxy_read_timeout 1h;
