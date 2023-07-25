import chalk from 'chalk';
import { Command } from "commander";
import { QueryOptions } from "winston";
import { logger } from "./logger";

const levels: Record<string, number> = { debug: 0, verbose: 0, info: 1, notice: 2, warning: 3, warn: 3, error: 4, crit: 5, alert: 6, emerg: 7 };
const colors: Record<string, string> = { debug: 'cyan', verbose: 'cyan', info: 'green', notice: 'green', warning: 'yellow', warn: 'yellow', error: 'red', crit: 'red', alert: 'red', emerg: 'red' };

function printQuery(fromTime: Date, toTime: Date | undefined, search: string | undefined, minLevel: number, maxLevel: number) {
    search = search?.toLowerCase();

    const queryOptions: QueryOptions = {
        from: fromTime,
        fields: ['level', 'timestamp', 'message', 'stack'],
        order: 'asc',
    };
    if (toTime) queryOptions.until = toTime;

    logger.query(queryOptions, (err, result) => {
        if (err) throw err;
        for (const { level, timestamp, message, stack } of result.dailyRotateFile) {
            // filter
            if (search && !(message ?? '').toLowerCase().includes(search)) continue;
            const levelNum = levels[level] ?? levels.info;
            if (levelNum < minLevel || levelNum > maxLevel) continue;
            // color
            const color = colors[level] ?? 'red';
            console.log(`${chalk.blueBright(timestamp)} ${chalk.keyword(color)(chalk.bold(level.toUpperCase()))} ${message}`);
            if (stack) console.log(chalk.gray(stack));
        }
    });
}

const program = new Command();
program
    .option('-f, --from <datetime>', 'Earliest time, default is 24h ago')
    .option('-t, --to <datetime>', 'Latest time, default is now')
    .option('-s, --search <text>', 'Return only line that contains substring <text>')
    .option('-l, --minLevel <level>', 'Return only lines with level above <level>')
    .option('-L, --maxLevel <text>', 'Return only lines with level below <level>')
    .parse(process.argv);
const options = program.opts();

const fromTime = options.from ? new Date(options.from) : new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
const toTime = options.to && new Date(options.to);
const minLevel = levels[options.minLevel] ?? levels.info;
const maxLevel = levels[options.maxLevel] ?? levels.emerg;

printQuery(fromTime, toTime, options.search, minLevel, maxLevel);
