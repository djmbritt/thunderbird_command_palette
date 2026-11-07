// Shapes shared by the popup scripts, for type checking only (see "Type
// checking" in CLAUDE.md). Referenced from JSDoc, e.g. `/** @type {Command[]} */`.

/** What the palette captured about the window it was opened from (see captureContext). */
interface PaletteContext {
  /** Active 3-pane mail tab of the originating window, or null. */
  mailTab: messenger.mailTabs.MailTab | null;
  /** Originating window. */
  windowId: number | null;
  /** Selected (mail tab) or displayed (message tab) messages. */
  selectedMessages: messenger.messages.MessageHeader[];
  /** Active compose tab, or null. */
  composeTab: messenger.tabs.Tab | null;
  /** compose.getComposeDetails() of composeTab, or null. */
  composeDetails: messenger.compose.ComposeDetails | null;
}

/** A palette entry: a root command, a picker item or a search result. See "Adding an action" in CLAUDE.md. */
interface Command {
  /** MRU key. Falls back to the label, which breaks on rename. */
  id?: string;
  /** Visible, fuzzy-matched and highlighted. May be a getter. */
  label: string;
  /** Single-character glyph. */
  icon?: string;
  /** Icon colour, e.g. a tag colour. */
  iconColor?: string;
  /** Dim right-side text; fuzzy-matched, not highlighted. May be a getter. */
  hint?: string;
  /** Hidden search terms. */
  keywords?: string;
  /** For the @ and # prefixes. */
  kind?: "folder" | "tag";
  /** Where the folder name starts in the label, so it's also scored on its own. */
  nameStart?: number;
  /** Hide the command unless this context is present. */
  requires?: "message" | "mailTab" | "compose";
  /** Two-step confirm; never recorded in MRU or repeated. */
  destructive?: boolean;
  /** Never recorded in MRU (ephemeral items such as tabs and search results). */
  noHistory?: boolean;
  /** Opens a sub-list instead of running. */
  picker?: () => PickerSpec | Promise<PickerSpec>;
  run?: () => unknown;
}

/** A command as listed: its match score and the matched label positions to highlight. */
interface ScoredCommand {
  cmd: Command;
  score: number;
  positions: number[];
}

/** What a command's `picker()` returns. */
interface PickerSpec {
  /** Banner text, e.g. "Move 3 messages to…". */
  title: string;
  items: Command[];
  placeholder?: string;
  /** Text shown when nothing matches. */
  empty?: string;
}

/** Passed to every command source. */
interface CommandEnv {
  accounts: messenger.accounts.MailAccount[];
}

/** Registered with registerCommands(); returns, or resolves to, commands. */
type CommandSource = (env: CommandEnv) => Command[] | Promise<Command[]>;

/** An account folder flattened for "Go to:" and the Move/Copy pickers (see collectFolders). */
interface FolderEntry {
  folder: messenger.folders.MailFolder;
  displayName: string;
  /** "<account> · <parent path>". */
  breadcrumb: string;
  icon: string;
  /** Account name, full path and special-use tags. */
  keywords: string;
}
