import { CommandRegistry } from '../commands/registry';

export class CommandPalette {
  constructor(private registry: CommandRegistry) {}

  getCommands() {
    return this.registry.getAll();
  }

  searchCommands(query: string) {
    return this.registry.search(query);
  }

  async executeCommand(commandId: string) {
    return this.registry.execute(commandId);
  }
}