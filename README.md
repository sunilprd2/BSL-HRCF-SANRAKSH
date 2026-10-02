# BSL (HRCF) - SANRAKSH — GitHub V2

This is the new GitHub/PWA build started from scratch.

## Implemented in this build
- Dynamic A/B/C shift status based on current time.
- All three shifts shown in Home and Shift Details.
- Shift cards are colour coded.
- Shift in-charge name and mobile are read from the Employees master.
- All shift filters include A, B, C and All Shifts.
- View Logs has working Edit flow.
- Add Log retrieves Area and Equipment masters from Google Sheets through the API.
- Total Time is automatically calculated from Start/End Time.
- Reports include Time split into Time and Total Time.
- Login authentication reads Users sheet only.
- New User activates an existing Staff No from Users when its password is blank.
- First-time password creation.
- After login, Employee Details loads the saved Employees-sheet profile.
- Staff No and Employee Name are read-only in the app.
- Department, Mobile, Employee Type and Designation can be updated by the employee.
- Employee Name changes only when the Users master is changed.
- PWA manifest/service worker included.
- Industrial background and SANRAKSH visual assets included.

## Google Apps Script API
`Code.gs` is a separate backend for this new GitHub build. It must be deployed as a Web App and connected to the same Google Sheet used by the completed system.

Before deployment:
1. Put the Google Spreadsheet ID into `SPREADSHEET_ID`.
2. Deploy as Web app.
3. Copy the `/exec` URL into `config.js` as `API_URL`.
4. Commit `config.js`.

Do not delete the old working Apps Script deployment or its backup.


### Cross-origin note
The GitHub Pages frontend uses JSONP GET requests because Apps Script Content Service redirects responses to a googleusercontent URL. This avoids the browser CORS/redirect failure when the frontend is hosted on GitHub Pages. Deploy the updated Code.gs as a new version before testing. The PWA sends a JSONP callback name (`prefix`) and the backend now returns the API result as JavaScript when that callback is supplied.
