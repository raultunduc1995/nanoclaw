import type OpenAI from "openai";

export const bashFunctionDeclaration: OpenAI.ChatCompletionFunctionTool = {
  type: "function",
  function: {
    name: "bash",
    description: `Execute a single bash command string on the local server.

ast-grep (sg) is pre-installed for structural AST code search and rewriting:
- Search: ast-grep run -l <lang> -p '<pattern>' <path>
- Rewrite: ast-grep run -l <lang> -p '<pattern>' -r '<rewrite>' -U <path>
  Flags: -p/--pattern, -r/--rewrite, -l/--lang (typescript, kotlin, etc.), -U/--update-all (apply in-place without asking).
- Metavariables: $VAR matches single AST node, $$$VAR matches multiple nodes/statements/args.
- Shell quoting: ALWAYS use single quotes ('...') around patterns and rewrites so bash does not expand metavariables.
- Complex relational rules: Write YAML rule to /tmp/rule.yaml and execute:
  ast-grep scan -r /tmp/rule.yaml -U <path>`,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The exact bash command line to run.",
        },
        restart: {
          type: "boolean",
          description: "Whether to restart the bash session (clearing all context) before executing this command.",
        },
      },
      required: ["command"],
    },
  },
};

export const searchFunctionDeclaration: OpenAI.ChatCompletionFunctionTool = {
  type: "function",
  function: {
    name: "search",
    description: `Search the web for live information and return structured results.

Supported query operators in 'query' (can be combined):
- site: Restrict to a site (join multiple with OR, e.g. "DeepSeek site:github.com OR site:huggingface.co").
- -site: Exclude a site (e.g. "DeepSeek -site:example.com").
- -term: Exclude pages containing a term (e.g. "DeepSeek -advertisement").
- -"phrase": Exclude pages containing an exact phrase (e.g. 'DeepSeek -"release notes"').
- "phrase": Match an exact phrase (e.g. 'DeepSeek "exact phrase"').
- lang: Restrict to comma-separated language codes (e.g. "DeepSeek lang:zh,en").
- after: Published after a date (e.g. "after:2025" or "after:2025-01-01").
- before: Published before a date (e.g. "before:2026" or "before:2026-06-01").

Returns { results: [...] } where each item contains:
- rerank_score (number, 0-3; >= 1.5 indicates high quality)
- title (string), url (string)
- snippet (string, ~100-200 chars), summary (string, ~600-800 chars)
- content (string, full page content when need_content is true, otherwise "")
- site_name (string | null), site_icon (string | null), date (RFC 3339 UTC string | null)
- authority (integer, 0-4 or -1 if unknown; >= 3 indicates highly authoritative source)`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'The search query (1 to 128 Unicode characters, cannot be all whitespace). Supports site:, -site:, -, -"...", "...", lang:, after:, before: operators.',
        },
        count: {
          type: "integer",
          description: "Number of results to return, between 1 and 50 (default 10).",
        },
        ori_question: {
          type: "string",
          description: "The user's original question that triggered the search (1 to 128 characters) to improve query understanding.",
        },
        need_content: {
          type: "boolean",
          description: "Whether to return full page content in the 'content' field (default false).",
        },
      },
      required: ["query"],
    },
  },
};

export const fetchFunctionDeclaration: OpenAI.ChatCompletionFunctionTool = {
  type: "function",
  function: {
    name: "fetch",
    description: `Retrieve a single web page and return its content as Markdown.

Returns { title: string, content: string }:
- title: The title of the page (empty string when unavailable).
- content: The fetched page content as Markdown text.`,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The page URL to fetch (at most 8192 characters, HTTP or HTTPS URL with a host, without username or password).",
        },
      },
      required: ["url"],
    },
  },
};
