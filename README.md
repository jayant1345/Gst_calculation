# GST Calculation & ITC Reconciliation Tool

A Flask web app for reconciling GST input tax credit (ITC) from purchase invoices. Upload invoices (PDF, image, or Excel/CSV purchase register), extract the tax details automatically via the Claude API, and export a formatted Excel reconciliation sheet.

## Features

- User login/registration (PostgreSQL-backed, hashed passwords)
- Invoice upload and OCR/parsing:
  - PDF and image invoices parsed via the Anthropic Claude API
  - Excel/CSV purchase registers parsed directly with pandas
- Automatic 50% eligible / 50% ineligible ITC split calculation
- Invoice CRUD (save, list, edit, delete, clear)
- Export a formatted Excel reconciliation sheet

## Requirements

- Python 3.10+
- PostgreSQL server running locally (or reachable via `DB_HOST`/`DB_PORT`)
- An Anthropic API key

## Setup

1. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

2. Create a `.env` file in the project root:
   ```
   ANTHROPIC_API_KEY=your-api-key
   PORT=5588
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=postgres
   DB_PASSWORD=your-db-password
   DB_NAME=postgres
   FLASK_SECRET_KEY=your-random-secret-key
   ```

3. Run the app:
   ```
   python app.py
   ```

   On first run, the `users` and `invoices` tables are created automatically, and a default admin account is seeded if the `users` table is empty:
   - Username: `admin`
   - Password: `admin`

   Change this password after first login.

4. Open [http://localhost:5588](http://localhost:5588) and log in.

## Project Structure

```
app.py                  Flask app: routes, DB access, Claude API calls, Excel export
templates/
  login.html            Login page
  register.html         Registration page
  index.html            Main app UI
static/
  app.js                Frontend logic
  style.css             Styling
requirements.txt        Python dependencies
```

## Notes

- Uploaded PDFs with extractable text are parsed as text; scanned/image-only PDFs and image files are sent to Claude as binary/base64 for OCR extraction.
- Excel/CSV registers are matched by column name (e.g. `invoice number`, `taxable value`, `cgst`, `sgst`, `igst`) with fallbacks to column position if headers aren't recognized.
- Do not commit `.env` — it contains API keys and database credentials.
