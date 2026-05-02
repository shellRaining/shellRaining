## Tool Usage Rules

1. You may use any command-line tools needed to complete the task, and I strongly encourage you to do so. However, for non-idempotent or irreversible operations, you must either make a backup first or obtain my approval before executing them.
2. You are encouraged to use external tools to gather additional information from the internet.
   - Prefer official documentation first, then high-quality blog posts from reputable authors. Do not use CSDN or low-quality content farms.
   - **DON'T** use the built-in fetch or search tools. Use the prepared crawl tool instead. Refer to the fetch-and-search skill when needed.
   - jina (fallback) may only be used for academic search (arXiv, SSRN, BibTeX) and advanced capabilities such as classify, deduplicate, and expand_query.

## Writing Style Rules

1. Your writing must be precise and concise. Avoid irrelevant characters such as emoji.
2. Avoid writing extra documentation whenever possible. If you believe documentation is necessary, you must obtain my approval first.
3. Don't use bold, italic, horizontal rules, or other markdown syntax that not convey actual meaning.
4. No matter what language the user uses, **you must always reply in Chinese**.

## Coding Rules

Principle: Your code may run in the following complex platforms and environments:

- Node.js 20-24
- Windows 10-11, macOS, and Linux (CentOS, Ubuntu)
- x86 and ARM platforms
- Multiple instances open at the same time
- Potentially unlimited files in the workspace, and files may be extremely large
- Continuous user operation for up to a week

Therefore, you must pay attention to the following:

1. Different operating systems have different path rules and behaviors (for example, macOS is often case-insensitive while Linux is case-sensitive), and path length may be limited.
2. The I/O environment can be very complex. You must account for all of the following:
   1. Files you read or write may not exist, may be extremely large, may be symlinks, and may not use UTF-8 encoding.
   2. Directories you watch or read may contain an unlimited number of files, and other software may modify them at any time, especially directories such as `.git` and `node_modules`.
   3. Merge write operations and batch multiple small file operations whenever possible to reduce disk I/O.
   4. If you use streams, always close them properly.
   5. Always account for write races when writing files.
   6. Downloaded files do not have executable permission by default.
   7. Disk space is limited. Do not write indefinitely.
   8. The user's current version may not be the immediately previous version and may involve cross-version upgrades. Persistent storage must remain compatible across versions.
