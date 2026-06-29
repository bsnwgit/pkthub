# Project Instructions

## Task List Rendering

Always render task lists as an interactive `show_widget` HTML widget — never a markdown table. Each task card must have three buttons: Work this (triggers `sendPrompt` to start work), Completed (triggers `sendPrompt` to mark done), and Commit (triggers `sendPrompt` to commit). Blocked tasks are dimmed at opacity 0.55 with a note. Always pull live task state from `TaskList` before rendering.
