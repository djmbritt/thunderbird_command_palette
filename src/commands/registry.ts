import { fuzzySearch } from '../utils/fuzzySearch';

export interface Command {
  id: string;
  title: string;
  description?: string;
  keywords?: string[];
  handler: () => Promise<void> | void;
}

export interface SearchResult {
  command: Command;
  score: number;
  matches: number[];
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

  search(query: string): SearchResult[] {
    const commands = this.getAll();
    
    // If no query, return all commands with score 0
    if (!query.trim()) {
      return commands.map(command => ({
        command,
        score: 0,
        matches: []
      }));
    }

    // Use fuzzy search
    const results = fuzzySearch(query, commands, (command) => {
      const searchableStrings = [command.title];
      
      if (command.description) {
        searchableStrings.push(command.description);
      }
      
      if (command.keywords) {
        searchableStrings.push(...command.keywords);
      }
      
      return searchableStrings;
    });

    // Map results to SearchResult format
    return results.map(result => ({
      command: result.item,
      score: result.score,
      matches: result.matches
    }));
  }

  async execute(commandId: string): Promise<void> {
    const command = this.get(commandId);
    if (!command) {
      throw new Error(`Command with id "${commandId}" not found`);
    }
    await command.handler();
  }
}