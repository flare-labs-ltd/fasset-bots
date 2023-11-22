# Run agent as a systemd service

1) Fix the service files  in this directory (for services that you want to run):

    * replace `/home/fasset-bots/fasset-bots` with the fasset-bots checkout directory
    * set `User` and `Group` to the user under which the service should run

2) Copy the service files to `/etc/systemd/system`

3) Run `sudo systemctl daemon-reload`, so that the system detects new services.

4) Now you can start (or stop) services by executing e.g.

        sudo systemctl start agent-bot

5) To make services start automatically at boot time, execute

        sudo systemctl enable agent-bot
