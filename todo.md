# UI
- [ ] Move the pill bars to bottom of page (output boxes are above pillbars, and code editor above that)
- [ ] move the + button and projects to the bottom of the rail growing from the bottom up (so it is basically flipping the UI)
- [ ] Show no pills by default

- [ ] Allow for spliting tabs out of code editor into multiple panes (similar to pillbar panels)
- [ ] Show hints for dropping code editor tabs and pillbars as well
- [ ] Save open files & layout in session storage

- [ ] File, Edit, View, Window (on mac and windows)
- [ ] File icons by type and/or extension

- [ ] Multi-window support
- [ ] Drag project off of app window to create new window

# Notifications
- [ ] Don't have notification for the project you are viewing show up in the notification center (cause they are already viewed)
- [ ] Hover project icon to show notification (if there is one)

# Terminal
- [ ] Fix powershell implementation
- [ ] Doesn't show indicator that process is running if new input isnt streaming in (need to follow markers and find edge cases)

# Claude
- [x] Interuptions cause conversation loss
- [x] Add interactive elements in output panel for certain things (like if questions are asked that need answered, plan mode/normal mode, approving edits and leaving plan mode (need to tell it multiple times to move out of plan mode and type /plan even tho it doesnt do anything))
- [x] Context tracking is way off (will show I am at 15000k/1000k of tokens)
- [x] MCP tool icon in status bar pushes the bar to be larger, meaning it is not in line with other panels (this also happens when the pillbar is multiline, the bottom of the output panel should stay in line with everything)
- [x] Way to change model
- [x] Reconnecting model loses conversation loss

# Github / Git
- [ ] Sometimes loses github login until the panel is opened
- [ ] Fetch changes from remote does not work (also so indication that it is fetching)
- [ ] Never see a pull from remote (even if there are changes on the remote)
- [ ] No options for merge, rebase, pull, push, checkout, cherry pick, switch branch (while there are edited items moving them to the other branch)
- [ ] Publish a branch doesn't work if there is not remote repo yet (need some sort of create repo flow)
- [ ] Show actions in github panel
- [ ] PRs do not show up in panel
- [ ] Clone repo crashes app

# Code Editor
- [ ] Save does not work (at least not visually, no way to know if something is saved or not)
- [ ] If file is edited while open (by a different process like claude) it does not show until close and reopen 
- [ ] Need more language support (Language servers???)