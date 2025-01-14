import { CommandLineError, logger, programVersion } from "@flarelabs/fasset-bots-core/utils";
import chalk from "chalk";
import path from "path";

const toplevelRunFinalizers: Array<() => Promise<void>> = [];

export function registerToplevelFinalizer(finalizer: () => Promise<void>) {
    toplevelRunFinalizers.push(finalizer);
}

// toplevel async function runner for node.js
export function toplevelRun(main: () => Promise<void>) {
    const scriptInfo = `${require.main?.filename ?? "UNKNOWN"} [pid=${process.pid}]`;
    logger.info(`************************************************************************************************************************`);
    try {
        const niceMainPath = path.relative(process.cwd(), process.argv[1]).replace(/\\/g, "/");
        logger.info(`***** EXECUTING: ${path.basename(process.argv[0])} ${niceMainPath} ${process.argv.slice(2).join(" ")}`);
    } catch (error) {
        logger.info(`***** EXECUTING: ${process.argv.join(" ")}`);
    }
    logger.info(`***** Version: ${programVersion()}`)
    logger.info(`***** ${scriptInfo} starting...`);
    runWithFinalizers(main)
        .then(() => {
            logger.info(`***** ${scriptInfo} ended successfully.`);
        })
        .catch((error) => {
            if (error instanceof CommandLineError) {
                logger.error(`***** ${scriptInfo} ended with user error: ${error}`);
                console.error(chalk.red("Error:"), error.message);
                process.exitCode = error.exitCode;
            } else {
                logger.error(`***** ${scriptInfo} ended with unexpected error:`, error);
                console.error(error?.stack ?? error);
                process.exitCode = 2;
            }
        })
        .finally(() => {
            // after 5s wait for close, terminate program
            const timeoutMS = 5000;
            setTimeout(() => {
                logger.warn(`***** ${scriptInfo} didn't exit after ${timeoutMS / 1000}s, terminating.`);
                setTimeout(() => { process.exit(process.exitCode ?? 0); }, 200); // wait for logger to finish
            }, timeoutMS).unref();
        });
}

async function runWithFinalizers(main: () => Promise<void>) {
    try {
        await main();
    } finally {
        // run registered finalizers
        while (toplevelRunFinalizers.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const finalizer = toplevelRunFinalizers.pop()!;
            try {
                await finalizer();
            } catch (e) {
                logger.error(`Error during program finalization [pid=${process.pid}]:`, e);
            }
        }
    }
}
