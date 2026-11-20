# Project Rules

1. Never write any comments in code (`//`, `/* */`, `<!-- -->`, `#` comments in source files, scripts, or configs). Keep all code completely comment-free.
2. Never run `git commit` or `git push` (or create commits/tags/pushes) unless the user explicitly asks to commit or push.
3. When the user explicitly asks to make a commit: write a plain, direct commit title summarizing the core change (no AI-style phrasing), and put a plain changelog in the commit description without decorative symbols or AI fluff using this format:
```
[+] Added new feature
[/] Fixed feature
[-] Deleted feature
```
