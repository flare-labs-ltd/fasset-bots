#!/bin/bash

USAGE_MSG="usage: entry [run-bots|run-liquidator]"

if [[ $# -ne 1 ]]; then
    echo $USAGE_MSG
    exit 1
fi

case $1 in
    run-bots)
        echo 'starting back-end and run-agent'
        /bin/sh -c '(yarn start_agent_api > log/agent_ui.log &) && (yarn run-agent > log/agent_run.log &) && (/bin/sh)'
        ;;
    run-liquidator)
        echo 'starting liquidator'
        /bin/sh -c '(yarn run-liquidator > log/liquidator_run.log &) && (/bin/sh)'
    ;;
    *)
        # The wrong first argument.
        echo "invalid argument: '$1'"
        echo $USAGE_MSG
        exit 1
esac