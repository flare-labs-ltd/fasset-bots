#!/bin/bash
source <(grep -v '^#' "./.env" | sed -E 's|^(.+)=(.*)$|: ${\1=\2}; export \1|g')

USAGE_MSG="usage: entry [run-bots|run-liquidator|run-challenger]"

if [[ $# -ne 1 ]]; then
    echo $USAGE_MSG
    exit 1
fi

case $1 in
    run-bots)
        echo 'starting back-end and run-agent'
        if [[ "${LOG_TARGET:-}" != 'console' ]]; then
            echo 'redirecting logs to file'
            /bin/sh -c '(yarn start_agent_api > log/agent_ui.log &) && (yarn run-agent > log/agent_run.log &) && (/bin/sh)'
        else
            echo 'logs will be printed to console'
            /bin/sh -c '(yarn start_agent_api &) && (yarn run-agent &) && (/bin/sh)'
        fi
        ;;
    run-liquidator)
        echo 'starting liquidator'
        if [[ "${LOG_TARGET:-}" != 'console' ]]; then
            echo 'redirecting logs to file'
            /bin/sh -c '(yarn run-liquidator > log/liquidator_run.log &) && (/bin/sh)'
        else
            echo 'logs will be printed to console'
            /bin/sh -c '(yarn run-liquidator &) && (/bin/sh)'
        fi
        ;;
    run-challenger)
        echo 'starting challenger'
        if [[ "${LOG_TARGET:-}" != 'console' ]]; then
            echo 'redirecting logs to file'
            /bin/sh -c '(yarn run-challenger > log/challenger_run.log &) && (/bin/sh)'
        else
            echo 'logs will be printed to console'
            /bin/sh -c '(yarn run-challenger &) && (/bin/sh)'
        fi
        ;;
    *)
        # The wrong first argument.
        echo "invalid argument: '$1'"
        echo $USAGE_MSG
        exit 1
esac