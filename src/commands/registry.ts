export interface Command {
  id: string;
  title: string;
  description?: string;
  keywords?: string[];
  handler: () => Promise<void> | void;
}

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();

  register(command: Command): void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command with id "${command.id}" already exists`);
    }
    this.commands.set(command.id, command);
  }

  unregister(commandId: string): boolean {
    return this.commands.delete(commandId);
  }

  get(commandId: string): Command | undefined {
    return this.commands.get(commandId);
  }

  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  search(query: string): Command[] {
    const normalizedQuery = query.toLowerCase();
    return this.getAll().filter(command => {
      const titleMatch = command.title.toLowerCase().includes(normalizedQuery);
      const descriptionMatch = command.description?.toLowerCase().includes(normalizedQuery) || false;
      const keywordMatch = command.keywords?.some(keyword => 
        keyword.toLowerCase().includes(normalizedQuery)
      ) || false;
      
      return titleMatch || descriptionMatch || keywordMatch;
    });
  }

  async execute(commandId: string): Promise<void> {
    const command = this.get(commandId);
    if (!command) {
      throw new Error(`Command with id "${commandId}" not found`);
    }
    await command.handler();
  }
}