import { Command } from 'commander';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { statusCommand } from './commands/status.js';
import { loginCommand } from './commands/login.js';
import { serveCommand } from './commands/serve.js';
import {
  profilesAddCommand,
  profilesListCommand,
  profilesRemoveCommand,
  profilesUseCommand
} from './commands/profiles.js';

const program = new Command();
program
  .name('ai-web-bridge')
  .description('CLI for the ai-web-bridge automation profile')
  .version('0.1.0');

program
  .command('start')
  .description('Launch the dedicated automation Chromium (idempotent)')
  .action(async () => {
    await startCommand();
  });

program
  .command('stop')
  .description('Terminate the automation Chromium')
  .action(async () => {
    await stopCommand();
  });

program
  .command('status')
  .description('Report Chromium + adapter session status')
  .action(async () => {
    await statusCommand();
  });

program
  .command('login')
  .argument('<site>', 'Adapter slug or hostname (e.g. claude-design or claude.ai)')
  .description('Open the automation Chromium at the named site so you can sign in')
  .action(async (site: string) => {
    await loginCommand(site);
  });

program
  .command('serve')
  .description('Run the MCP server in the foreground (stdio transport)')
  .action(async () => {
    await serveCommand();
  });

const profiles = program
  .command('profiles')
  .description('Manage named login profiles (each profile is a separate Chromium user-data-dir)');

profiles
  .command('list')
  .description('List all profiles; the active one is prefixed with *')
  .action(async () => {
    await profilesListCommand();
  });

profiles
  .command('add')
  .argument('<name>', 'Profile name (lowercase alphanumeric, dashes, underscores)')
  .description('Create a new empty profile')
  .action(async (name: string) => {
    await profilesAddCommand(name);
  });

profiles
  .command('use')
  .argument('<name>', 'Profile name to make active')
  .description('Switch the active profile (subsequent calls target this profile)')
  .action(async (name: string) => {
    await profilesUseCommand(name);
  });

profiles
  .command('remove')
  .argument('<name>', 'Profile name to delete')
  .description('Delete a profile (refuses the active profile and the last remaining profile)')
  .action(async (name: string) => {
    await profilesRemoveCommand(name);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
