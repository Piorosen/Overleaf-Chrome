// Overleaf AI — tool definitions for agent mode (shared by mcp-server.js and host.js).
'use strict';

const TOOLS = [
  {
    name: 'list_files',
    description: 'List the files of the Overleaf project (path and type) and which file is open in the editor. Call this first to see the project structure.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_file',
    description: 'Read a project file (.tex, .bib, .sty, .md …) with 1-based line numbers. Use start_line/end_line for long files. The open file is read live from the editor, including unsaved edits.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path as shown by list_files, e.g. "sections/intro.tex" or "main.tex"' },
        start_line: { type: 'integer', minimum: 1 },
        end_line: { type: 'integer', minimum: 1 },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_project',
    description: 'Search all text files of the project. Returns "path:line: text" matches. Case-insensitive literal search by default; set regex=true for a JavaScript regular expression.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        regex: { type: 'boolean' },
        path: { type: 'string', description: 'Limit to one file (optional)' },
        max_results: { type: 'integer', minimum: 1, maximum: 200 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_editor_state',
    description: 'The file open in the editor, the cursor line, and the currently selected text (what the user is looking at).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'propose_edit',
    description: 'Propose replacing an exact snippet of a file with new text. The file is NOT changed: the user reviews each proposal as a diff and applies or rejects it. old_string must appear exactly once in the file (include surrounding lines to make it unique); to insert, include an anchor line in old_string and repeat it in new_string. Keep each proposal small (a sentence, paragraph or environment) and LaTeX-valid; preserve \\cite, \\ref, \\label and math unless asked.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string', description: 'Exact current text to replace (must be unique in the file)' },
        new_string: { type: 'string', description: 'Replacement text' },
        explanation: { type: 'string', description: 'One sentence: why this change (shown to the user)' },
      },
      required: ['path', 'old_string', 'new_string', 'explanation'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_compile_log',
    description: 'Errors and warnings from the latest LaTeX compile of the project (file, line, message). Use to diagnose compile errors.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_checks',
    description: 'Run fast local checks on a .tex file: undefined/duplicate labels, unbalanced braces/environments, missing \\usepackage, undefined acronyms, inconsistent spellings/terms, long sentences, leftover TODOs. Use after proposing edits to verify.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Defaults to the open file' } }, additionalProperties: false },
  },
  {
    name: 'bib_lookup',
    description: 'Look up real bibliographic records (arXiv, Semantic Scholar, OpenAlex, DOI/Crossref) by DOI, arXiv ID or title. Returns candidates with ready-to-use BibTeX. Never invent references; use this instead.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'get_paper_profile',
    description: 'The author\'s paper profile: target venue and style, field, audience, US/UK spelling, terminology glossary, notes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

module.exports = { TOOLS };
