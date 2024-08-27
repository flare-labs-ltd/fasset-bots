import "dotenv/config";
import "source-map-support/register";

import {
    Secrets, createBotOrm,
    loadConfigFile,
} from "@flarelabs/fasset-bots-core/config";
import {
    CommandLineError
    } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

const program = programWithCommonOptions("agent", "all_fassets");

program.name("utils").description("Command line utils");

program
    .command("createInitialMigration")
    .description("create initial migration")
    .action(async () => {
        const options: { config: string; secrets: string } = program.opts();
        console.log(options.config)
        console.log(options.secrets)
        const config = loadConfigFile(options.config);
        const secrets = Secrets.load(options.secrets);
        const orm = await createBotOrm("user", config.ormOptions, secrets.data.database);
        if (!orm) {
            throw new CommandLineError("orm not defined");
        }
        const migrator = orm.getMigrator();
        await migrator.createInitialMigration();
        await orm.close(true);
    });

program
    .command("createMigration")
    .description("create migration")
    .action(async () => {
        const options: { config: string; secrets: string } = program.opts();
        const config = loadConfigFile(options.config);
        const secrets = Secrets.load(options.secrets);
        const orm = await createBotOrm("user", config.ormOptions, secrets.data.database);
        if (!orm) {
            throw new CommandLineError("orm not defined");
        }
        const migrator = orm.getMigrator();
        await migrator.createMigration();
        await orm.close(true);
    });

 program
    .command("runMigrations")
    .description("run migrations")
    .action(async () => {
        const options: { config: string; secrets: string } = program.opts();
        const config = loadConfigFile(options.config);
        const secrets = Secrets.load(options.secrets);
        const orm = await createBotOrm("user", config.ormOptions, secrets.data.database);
        if (!orm) {
            throw new CommandLineError("orm not defined");
        }
        const migrator = orm.getMigrator();
        await migrator.up();
        await orm.close(true);
    });

toplevelRun(async () => {
    await program.parseAsync();
});
