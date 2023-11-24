# Run agent as a systemd service

All the examples are for `agent-bot` service. For other services, just change `agent-bot` to the service name.

1. Fix the service files  in this directory:

    * replace `/home/fasset-bots/fasset-bots` with the `fasset-bots` checkout directory
    * set `User` and `Group` to the user under which the service should run
    * if necessary, change the path to `node` in `ExecStart`

2. Copy the `.service` files for services that you want to run to `/etc/systemd/system`.

3. Run `sudo systemctl daemon-reload`, so that the system detects new services.

4. Now you can start (or stop) services by executing e.g.
```
sudo systemctl start agent-bot
```

5. To make services start automatically at boot time, execute
```
sudo systemctl enable agent-bot
```

6. To view the console output use command
```
sudo journalctl -fu agent-bot.service
```
This will follow the output. To show the past output in `less`, call instead
```
sudo journalctl -eu agent-bot.service
```
