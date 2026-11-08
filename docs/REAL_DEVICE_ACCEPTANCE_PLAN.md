# Pinglet real-device acceptance plan

**Purpose:** Repeatable Level 3 acceptance test for the Android build.  
**Status:** Not run. No physical Android device was connected during this inspection.  
**Required environment:** A staging backend and disposable staging database, separate from production.  
**Test data:** Two or more test-only accounts with non-personal names and dummy messages.

## Safety and test boundaries

- Have the accountable adult operator approve the staging environment and test window.
- Do not run destructive tests against production accounts or the production database.
- Do not use real users' messages, voice clips, contact details or friend codes as fixtures.
- Do not capture screenshots containing passwords, access tokens, private chats, real friend codes or personal information.
- Stop a test if it unexpectedly reaches production, displays another person's data, or performs an action that cannot be safely undone.
- A tester should not grant camera/microphone permissions to an app build they do not trust. Deny permissions when checking the denied-permission experience.

## Device and environment matrix

Record exact device model, Android version, app version, build commit, backend environment and date for every run.

| Device profile | Required checks |
|---|---|
| Current supported Android device | Full sign-up, messaging, friend, safety, call, permissions and accessibility pass. |
| Older supported Android device | Core flows, UI scaling, performance, camera/microphone permissions, reconnect and reduced-motion behavior. |
| Small-screen phone | Keyboard, dialog, chat composer, long names, long messages, friend list and navigation are not clipped. |
| Larger-screen phone or tablet (if supported) | Responsive layout, call grid, keyboard and orientation changes. |

Minimum test network set:
- Stable Wi-Fi.
- Mobile data.
- A different network where direct peer-to-peer connectivity may be restricted; use this to verify TURN behavior once a trusted TURN relay has been configured.

Do not report the call matrix as passed until at least two independent physical devices and the required network conditions have been used.

## Pre-flight checklist

- [ ] Confirm the installed build came from the intended CI run and record its commit SHA.
- [ ] Confirm this is a staging build and its API base URL points to staging.
- [ ] Confirm the staging database contains no production user data.
- [ ] Confirm the test accounts are disposable and their passwords are unique to the test.
- [ ] Confirm test reports will be reviewed by an assigned staging moderator.
- [ ] Confirm test account deletion is safe and expected.
- [ ] Confirm the tester can reach a service operator if a privacy or safety issue appears.

## Test cases

For every case, record: **Pass / Fail / Blocked / Not run**, device, Android version, build SHA, steps, actual result, expected result, issue link and retest date.

### A. Install, launch and session lifecycle

- [ ] Fresh install opens the locally bundled interface without requiring the hosted website page to load.
- [ ] With staging API unavailable, the UI shows a clear offline/wake-up state and does not expose stale private data.
- [ ] When the staging API returns, retry/reconnect restores the session without duplicating a write.
- [ ] Sign-up validates required fields and terms acceptance.
- [ ] Sign-in succeeds with correct credentials and rejects incorrect credentials without revealing whether an account exists.
- [ ] Sign-out removes the local session and returns to the signed-out screen.
- [ ] Expired session returns the user to a safe sign-in state.
- [ ] App background/resume does not silently duplicate a message or leave a stale socket session.

### B. Friend and invite journeys

- [ ] Create a disposable account and record its test friend code in the private test record only.
- [ ] Add the second test account using a friend code.
- [ ] Accept, decline and cancel/retry friend requests.
- [ ] Verify duplicate and reciprocal requests do not create duplicate friendships.
- [ ] Scan a QR invite using the camera after granting permission.
- [ ] Import a QR image using the supported image flow, if present.
- [ ] Cancel camera permission and confirm the user receives a clear explanation and can continue without scanning.
- [ ] Search and filter the friend list using empty, short and long input.
- [ ] Change a private friendship label and confirm it is private to the acting account.

### C. Chat and voice messages

- [ ] Send and receive a short text message between the two test accounts.
- [ ] Send a long message and verify layout, wrapping and scroll behavior.
- [ ] Switch conversations with unsent drafts and confirm each draft stays with the correct test conversation.
- [ ] Submit empty/whitespace-only content and confirm no empty message is sent.
- [ ] Reconnect during a conversation and verify history is ordered and messages are not duplicated.
- [ ] On physical Android devices, scroll through history beyond 100 test messages and verify older messages load without gaps or repeats. The API pagination boundary test passed in CI; device-level behavior remains untested.
- [ ] Record and send an allowed short voice clip after granting microphone access.
- [ ] Deny microphone access and confirm the app explains the limitation without hanging.
- [ ] Confirm leaving the chat or signing out stops recording/playback and releases media resources.
- [ ] Submit a voice-message report and inspect exactly what report evidence is stored; the UI must not claim the audio was attached unless it actually was.

### D. Reporting, blocking and account control

- [ ] Report a test account using each supported category and verify the report appears only in the protected staging moderation queue.
- [ ] A moderator can inspect, record an action and close a test report according to the staging procedure.
- [ ] An ordinary user cannot access the moderation queue.
- [ ] Block the second test account and verify friend state, message sends and live sessions stop according to the documented behavior.
- [ ] Verify the blocked test account cannot restart contact through another API/socket path.
- [ ] Unblock and verify the relationship is not silently restored without a new user action.
- [ ] Open the safety/account screen and verify report, block, blocked-account management, policy links and deletion controls are reachable.
- [ ] Attempt account deletion with a wrong password; confirm no deletion occurs.
- [ ] Delete a disposable account with the correct password and verify the documented deletion/anonymisation behavior in staging.
- [ ] Confirm the public deletion page works without signing in, but do not submit another user's information.

### E. Games and calls

- [ ] Rock Paper Scissors opens from each supported entry point and works with touch and keyboard/accessibility controls.
- [ ] Snake Duel invitation, join, gameplay and exit work for two test accounts.
- [ ] Disconnect one player and verify the other sees a clear end/reconnect state.
- [ ] Create a private voice room and join from a second physical device.
- [ ] Create a video room and join from a second physical device.
- [ ] Confirm a room rejects an invalid code and enforces the documented participant limit.
- [ ] Deny camera access and confirm voice-only behavior remains clear and usable.
- [ ] Toggle microphone and camera; verify the remote participant sees the correct state.
- [ ] Leave a call and confirm all local audio/video tracks stop.
- [ ] Test call setup on Wi-Fi and mobile data.
- [ ] After TURN is configured, confirm relay use on a network where direct peer-to-peer connectivity is unavailable.
- [ ] Restart the staging service during a disposable call/game and record whether the session ends cleanly and how each client recovers.
- [ ] Try reporting or blocking during a call once those controls are implemented.

### F. Accessibility, layout and interaction

- [ ] Complete sign-up, friend add, chat, report and deletion using only keyboard navigation where supported.
- [ ] Complete primary journeys with Android screen reader support.
- [ ] Increase Android display/font size and verify labels, buttons and forms remain usable.
- [ ] Verify touch targets are practical and no important control is icon-only without an accessible name.
- [ ] Open and close every dialog using its visible controls; verify focus moves into the dialog, remains within it as appropriate, and returns to the invoking control.
- [ ] Verify the dialog has an accessible name and correct dialog semantics.
- [ ] Verify error and status messages are announced and visually distinguishable.
- [ ] Verify contrast in every theme, including custom wallpapers.
- [ ] Enable reduced motion and confirm non-essential animation is reduced or removed.
- [ ] Rotate the device and open/close the keyboard without losing the active task or clipping actions.
- [ ] Verify the send button, report controls and destructive actions have clear labels and safe confirmation.

### G. Privacy and data handling

- [ ] Confirm the staging app never displays one test account's private data to the other account unless explicitly shared.
- [ ] Confirm no API token, database credential or moderator secret appears in UI, logs visible to testers, crash output or app package.
- [ ] Confirm local sign-out clears session data according to the documented design.
- [ ] Confirm cached app-shell files do not cache authenticated API or Socket.IO responses.
- [ ] Verify privacy/terms/child-safety pages are reachable and match the operator-approved policy text.
- [ ] Verify test account deletion and any backup/retention delay are explained accurately.

## Severity and release decision

Use the following severity definitions:

- **Critical:** another user's private data is exposed; authentication or access control can be bypassed; a destructive action affects the wrong account/data; safety reporting or block enforcement is materially broken.
- **High:** primary sign-up, messaging, reporting, blocking, deletion or call flows fail; media does not stop when leaving; a serious accessibility barrier prevents use of a core function.
- **Medium:** a core journey works with a workaround, or a non-core interaction is unreliable or confusing.
- **Low:** cosmetic issue with no privacy, safety, accessibility or core-function impact.

**Release rule:** Any open Critical or High issue blocks release. Medium issues require an owner, risk decision and documented follow-up. Do not waive a safety/privacy defect solely because automated tests pass.

## Run record

Copy this section for each test run.

- Date/time:
- Tester role (no personal details):
- Device model:
- Android version:
- App version:
- Build commit SHA:
- Staging API environment:
- Test accounts used (test aliases only):
- Network:
- Cases passed:
- Cases failed:
- Cases blocked/not run:
- Critical/High issues:
- Evidence location (redacted, no credentials or private conversations):
- Retest result:
- Operator release decision:
