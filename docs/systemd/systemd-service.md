# Run agent as a `systemd` Service

All the examples are for the `agent-bot` service.
Change `agent-bot` to the service name you want to run for other services, for instance, `liquidator-bot.`

1. Fix the service files  in this directory:

    * replace `/home/fasset-bots/fasset-bots` with the `fasset-bots` checkout directory;
    * set `User` and `Group` to the user under which the service should run;
    * change the path to `node` in `ExecStart` if necessary.

2. Copy the `.service` files for services you want to run to `/etc/systemd/system`.

3. Run `sudo systemctl daemon-reload`, so that the system detects new services.

4. Now you can start (or stop) services by executing:

   ```console
   sudo systemctl start agent-bot
   ```

5. To make services start automatically at boot time, execute:

   ```console
   sudo systemctl enable agent-bot
   ```

6. To view the console output, use command:

   ```console
   sudo journalctl -fu agent-bot.service
   ```

    This will follow the output.
    To show the past output in `less`, call instead

   ```console
   sudo journalctl -eu agent-bot.service
   ```
