import os
import json
import base64
import urllib.request
import ssl
from flask import Flask, request, jsonify, render_template, send_file, redirect, url_for, session, flash
import pandas as pd
from pypdf import PdfReader
from dotenv import load_dotenv
import io
import psycopg2
import psycopg2.extras
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps

# Load environment variables
load_dotenv()

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = os.getenv("FLASK_SECRET_KEY", "949539d0c64bdf34138e6be019a552bf")

# SSL context for API calls
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# Read API Key
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# PostgreSQL Connection Helper
def get_db_connection():
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", "5432"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "Jay@0381"),
        database=os.getenv("DB_NAME", "postgres")
    )
    return conn

# Database Tables Initialization
def init_db():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Create users table
        cur.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        ''')

        # Migrate existing installs that predate the is_admin column
        cur.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;')


        # Create invoices table (using numeric for high-precision currency values)
        cur.execute('''
            CREATE TABLE IF NOT EXISTS invoices (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                invoice_number VARCHAR(50),
                invoice_date VARCHAR(20),
                vendor_name VARCHAR(150),
                taxable_value NUMERIC(15,2),
                cgst NUMERIC(15,2),
                sgst NUMERIC(15,2),
                igst NUMERIC(15,2),
                eligible_itc NUMERIC(15,2),
                ineligible_itc NUMERIC(15,2),
                file_data BYTEA,
                file_mime_type VARCHAR(100),
                file_name VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        ''')

        # Migrate existing installs that predate the original-file columns
        cur.execute('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS file_data BYTEA;')
        cur.execute('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS file_mime_type VARCHAR(100);')
        cur.execute('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);')


        conn.commit()
        
        # Auto-seed a default user 'admin' if the users table is empty
        cur.execute('SELECT COUNT(*) FROM users;')
        count = cur.fetchone()[0]
        if count == 0:
            default_username = 'admin'
            default_password = 'admin'
            hashed_pw = generate_password_hash(default_password)
            cur.execute('INSERT INTO users (username, password_hash, is_admin) VALUES (%s, %s, TRUE)', (default_username, hashed_pw))
            conn.commit()
            print("Seeded default admin user account: admin / admin")

        # Ensure the 'admin' account is always flagged as admin, even on installs
        # created before the is_admin column existed
        cur.execute("UPDATE users SET is_admin = TRUE WHERE username = 'admin' AND is_admin = FALSE;")
        conn.commit()

        # Backfill NULL fields on invoices saved before extracted-field
        # normalization existed, which otherwise crash the table renderer
        cur.execute("UPDATE invoices SET vendor_name = 'Unknown Vendor' WHERE vendor_name IS NULL;")
        cur.execute("UPDATE invoices SET invoice_number = 'N/A' WHERE invoice_number IS NULL;")
        cur.execute("UPDATE invoices SET invoice_date = 'N/A' WHERE invoice_date IS NULL;")
        cur.execute("UPDATE invoices SET taxable_value = 0 WHERE taxable_value IS NULL;")
        cur.execute("UPDATE invoices SET cgst = 0 WHERE cgst IS NULL;")
        cur.execute("UPDATE invoices SET sgst = 0 WHERE sgst IS NULL;")
        cur.execute("UPDATE invoices SET igst = 0 WHERE igst IS NULL;")
        cur.execute("UPDATE invoices SET eligible_itc = 0 WHERE eligible_itc IS NULL;")
        cur.execute("UPDATE invoices SET ineligible_itc = 0 WHERE ineligible_itc IS NULL;")
        conn.commit()

        cur.close()
        conn.close()
        print("PostgreSQL Database initialized successfully.")
    except Exception as e:
        print(f"Error initializing PostgreSQL database: {e}")

# Decorator to secure endpoints
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def is_admin_user():
    """Checks admin status directly from the database rather than trusting a
    value cached in the session cookie, so role changes take effect immediately
    without requiring the user to log out and back in."""
    if 'user_id' not in session:
        return False
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('SELECT is_admin FROM users WHERE id = %s', (session['user_id'],))
        row = cur.fetchone()
        cur.close()
        conn.close()
        return bool(row[0]) if row else False
    except Exception:
        return False

def call_claude_api(payload):
    """Utility to make direct HTTP requests to the Anthropic Claude API."""
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }
    
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, context=ctx) as res:
            response = json.loads(res.read().decode("utf-8"))
            return response["content"][0]["text"]
    except Exception as e:
        print(f"Error calling Anthropic API: {e}")
        raise e

def extract_from_text(text):
    """Sends extracted text to Claude to parse invoice details into JSON."""
    system_prompt = (
        "You are an expert financial OCR assistant. Analyze the provided invoice text "
        "and extract the key values. You must respond with ONLY a valid JSON object. "
        "Do not include any explanation or markdown formatting outside the JSON."
    )
    
    user_prompt = f"""
    Please extract the following details from this invoice text:
    - Invoice Number (invoice_number)
    - Invoice Date (invoice_date)
    - Vendor Name (vendor_name)
    - Taxable Value (taxable_value) - The value before taxes
    - CGST Amount (cgst)
    - SGST Amount (sgst)
    - IGST Amount (igst)

    Invoice Text:
    ---
    {text}
    ---

    Provide the output in the following JSON format:
    {{
      "invoice_number": "...",
      "invoice_date": "...",
      "vendor_name": "...",
      "taxable_value": 0.0,
      "cgst": 0.0,
      "sgst": 0.0,
      "igst": 0.0
    }}
    """
    
    payload = {
        "model": "claude-sonnet-4-6",
        "max_tokens": 1000,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_prompt}
        ]
    }
    
    result = call_claude_api(payload)
    if "```json" in result:
        result = result.split("```json")[1].split("```")[0].strip()
    elif "```" in result:
        result = result.split("```")[1].split("```")[0].strip()
    return json.loads(result)

def extract_from_image(base64_data, mime_type):
    """Sends a base64 encoded invoice image to Claude to parse details into JSON."""
    system_prompt = (
        "You are an expert financial OCR assistant. Analyze the invoice image "
        "and extract the key values. You must respond with ONLY a valid JSON object. "
        "Do not include any explanation or markdown formatting outside the JSON."
    )
    
    user_prompt = "Extract invoice details: invoice_number, invoice_date, vendor_name, taxable_value, cgst, sgst, igst."
    
    payload = {
        "model": "claude-sonnet-4-6",
        "max_tokens": 1000,
        "system": system_prompt,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime_type,
                            "data": base64_data
                        }
                    },
                    {
                        "type": "text",
                        "text": user_prompt
                    }
                ]
            }
        ]
    }
    
    result = call_claude_api(payload)
    if "```json" in result:
        result = result.split("```json")[1].split("```")[0].strip()
    elif "```" in result:
        result = result.split("```")[1].split("```")[0].strip()
    return json.loads(result)

def extract_from_pdf_binary(base64_pdf):
    """Sends a base64 encoded PDF directly to Claude using the PDF beta feature."""
    system_prompt = (
        "You are an expert financial OCR assistant. Analyze the invoice PDF document "
        "and extract the key values. You must respond with ONLY a valid JSON object. "
        "Do not include any explanation or markdown formatting outside the JSON."
    )
    
    user_prompt = "Extract invoice details: invoice_number, invoice_date, vendor_name, taxable_value, cgst, sgst, igst."
    
    payload = {
        "model": "claude-sonnet-4-6",
        "max_tokens": 1000,
        "system": system_prompt,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": base64_pdf
                        }
                    },
                    {
                        "type": "text",
                        "text": user_prompt
                    }
                ]
            }
        ]
    }
    
    result = call_claude_api(payload)
    if "```json" in result:
        result = result.split("```json")[1].split("```")[0].strip()
    elif "```" in result:
        result = result.split("```")[1].split("```")[0].strip()
    return json.loads(result)

def parse_excel_register(file_bytes):
    """Parses a purchase register or GSTR-2B Excel file using Pandas."""
    df = pd.read_excel(io.BytesIO(file_bytes))
    
    # Clean column names
    orig_cols = list(df.columns)
    clean_cols = [str(c).strip().lower().replace("_", "").replace(" ", "").replace(".", "") for c in df.columns]
    
    col_mapping = {}
    for orig, clean in zip(orig_cols, clean_cols):
        col_mapping[clean] = orig
        
    def find_column(options):
        for opt in options:
            if opt in col_mapping:
                return col_mapping[opt]
        return None

    inv_num_cols = ["invoicenumber", "invoiceno", "invno", "invoicenum", "billno", "documentnumber", "docno"]
    inv_date_cols = ["invoicedate", "invdate", "billdate", "documentdate", "docdate", "date"]
    vendor_cols = ["vendorname", "suppliername", "partyname", "vendor", "supplier", "party", "legalname"]
    taxable_cols = ["taxablevalue", "taxableamt", "taxableamount", "assessablevalue", "taxval", "value"]
    cgst_cols = ["cgst", "cgstamount", "cgstamt", "centraltax"]
    sgst_cols = ["sgst", "sgstamount", "sgstamt", "statetax", "utgst", "unionterritorytax"]
    igst_cols = ["igst", "igstamount", "igstamt", "integratedtax"]

    col_num = find_column(inv_num_cols)
    col_date = find_column(inv_date_cols)
    col_vendor = find_column(vendor_cols)
    col_taxable = find_column(taxable_cols)
    col_cgst = find_column(cgst_cols)
    col_sgst = find_column(sgst_cols)
    col_igst = find_column(igst_cols)

    if not col_vendor and len(orig_cols) > 0: col_vendor = orig_cols[0]
    if not col_num and len(orig_cols) > 1: col_num = orig_cols[1]
    if not col_date and len(orig_cols) > 2: col_date = orig_cols[2]

    invoices = []
    for _, row in df.iterrows():
        try:
            vendor = str(row[col_vendor]) if col_vendor and pd.notna(row[col_vendor]) else "Unknown Vendor"
            inv_no = str(row[col_num]) if col_num and pd.notna(row[col_num]) else "N/A"
            inv_date = str(row[col_date]).split(" ")[0] if col_date and pd.notna(row[col_date]) else "N/A"
            
            taxable = float(row[col_taxable]) if col_taxable and pd.notna(row[col_taxable]) else 0.0
            cgst = float(row[col_cgst]) if col_cgst and pd.notna(row[col_cgst]) else 0.0
            sgst = float(row[col_sgst]) if col_sgst and pd.notna(row[col_sgst]) else 0.0
            igst = float(row[col_igst]) if col_igst and pd.notna(row[col_igst]) else 0.0
            
            invoices.append({
                "invoice_number": inv_no,
                "invoice_date": inv_date,
                "vendor_name": vendor,
                "taxable_value": taxable,
                "cgst": cgst,
                "sgst": sgst,
                "igst": igst
            })
        except Exception as ex:
            print(f"Error parsing row: {ex}")
            continue
            
    return invoices

# Web Router Pages
@app.route('/')
@login_required
def home():
    return render_template('index.html', is_admin=is_admin_user())

@app.route('/login', methods=['GET', 'POST'])
def login():
    if 'user_id' in session:
        return redirect(url_for('home'))
        
    error = None
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()
        
        try:
            conn = get_db_connection()
            cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
            cur.execute('SELECT * FROM users WHERE username = %s', (username,))
            user = cur.fetchone()
            cur.close()
            conn.close()
            
            if user and check_password_hash(user['password_hash'], password):
                session['user_id'] = user['id']
                session['username'] = user['username']
                session['is_admin'] = bool(user['is_admin'])
                return redirect(url_for('home'))
            else:
                error = "Invalid username or password"
        except Exception as e:
            error = f"Database connection error: {e}"
            
    return render_template('login.html', error=error)

@app.route('/register', methods=['GET', 'POST'])
def register():
    if 'user_id' in session:
        return redirect(url_for('home'))
        
    error = None
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()

        if not username or not password:
            error = "All fields are required"
        else:
            try:
                conn = get_db_connection()
                cur = conn.cursor()
                # Check duplicate username
                cur.execute('SELECT id FROM users WHERE username = %s', (username,))
                if cur.fetchone():
                    error = "Username already exists"
                else:
                    # Create user
                    hashed_pw = generate_password_hash(password)
                    cur.execute('INSERT INTO users (username, password_hash) VALUES (%s, %s)', (username, hashed_pw))
                    conn.commit()
                    cur.close()
                    conn.close()
                    flash("Registration successful! You can now log in.", "success")
                    return redirect(url_for('login'))
                cur.close()
                conn.close()
            except Exception as e:
                error = f"Database connection error: {e}"

    return render_template('register.html', error=error)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/settings', methods=['GET', 'POST'])
@login_required
def settings():
    error = None
    if request.method == 'POST':
        current_password = request.form.get('current_password', '').strip()
        new_password = request.form.get('new_password', '').strip()
        confirm_password = request.form.get('confirm_password', '').strip()

        if not current_password or not new_password or not confirm_password:
            error = "All fields are required"
        elif new_password != confirm_password:
            error = "New password and confirmation do not match"
        else:
            try:
                conn = get_db_connection()
                cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
                cur.execute('SELECT * FROM users WHERE id = %s', (session['user_id'],))
                user = cur.fetchone()

                if not user or not check_password_hash(user['password_hash'], current_password):
                    error = "Current password is incorrect"
                else:
                    hashed_pw = generate_password_hash(new_password)
                    cur.execute('UPDATE users SET password_hash = %s WHERE id = %s', (hashed_pw, session['user_id']))
                    conn.commit()

                cur.close()
                conn.close()

                if not error:
                    flash("Password updated successfully.", "success")
                    return redirect(url_for('settings'))
            except Exception as e:
                error = f"Database connection error: {e}"

    return render_template('settings.html', error=error)

# API Endpoints
@app.route('/api/get-invoices', methods=['GET'])
@login_required
def get_invoices():
    user_id = session['user_id']
    is_admin = is_admin_user()
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if is_admin:
            cur.execute('''
                SELECT invoices.id, invoice_number, invoice_date, vendor_name,
                       taxable_value::float, cgst::float, sgst::float, igst::float,
                       eligible_itc::float, ineligible_itc::float, users.username,
                       (file_data IS NOT NULL) AS has_file
                FROM invoices
                JOIN users ON users.id = invoices.user_id
                ORDER BY invoices.created_at DESC
            ''')
        else:
            cur.execute('''
                SELECT id, invoice_number, invoice_date, vendor_name,
                       taxable_value::float, cgst::float, sgst::float, igst::float,
                       eligible_itc::float, ineligible_itc::float,
                       (file_data IS NOT NULL) AS has_file
                FROM invoices
                WHERE user_id = %s
                ORDER BY created_at DESC
            ''', (user_id,))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return jsonify({"invoices": rows})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/save-invoice', methods=['POST'])
@login_required
def save_invoice():
    user_id = session['user_id']
    inv = request.json
    
    db_id = inv.get('id')
    inv_num = inv.get('invoice_number', '')
    inv_date = inv.get('invoice_date', '')
    vendor = inv.get('vendor_name', '')
    taxable = float(inv.get('taxable_value', 0.0))
    cgst = float(inv.get('cgst', 0.0))
    sgst = float(inv.get('sgst', 0.0))
    igst = float(inv.get('igst', 0.0))
    
    # Recalculate 50% split on server to ensure precision
    total_gst = cgst + sgst + igst
    eligible = round(total_gst * 0.5, 2)
    ineligible = round(total_gst * 0.5, 2)
    
    is_admin = is_admin_user()

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        if db_id:
            # Update existing invoice (admins may edit any user's invoice)
            if is_admin:
                cur.execute('''
                    UPDATE invoices
                    SET invoice_number = %s, invoice_date = %s, vendor_name = %s,
                        taxable_value = %s, cgst = %s, sgst = %s, igst = %s,
                        eligible_itc = %s, ineligible_itc = %s
                    WHERE id = %s
                ''', (inv_num, inv_date, vendor, taxable, cgst, sgst, igst, eligible, ineligible, db_id))
            else:
                cur.execute('''
                    UPDATE invoices
                    SET invoice_number = %s, invoice_date = %s, vendor_name = %s,
                        taxable_value = %s, cgst = %s, sgst = %s, igst = %s,
                        eligible_itc = %s, ineligible_itc = %s
                    WHERE id = %s AND user_id = %s
                ''', (inv_num, inv_date, vendor, taxable, cgst, sgst, igst, eligible, ineligible, db_id, user_id))
            ret_id = db_id
        else:
            # Insert new invoice
            cur.execute('''
                INSERT INTO invoices (user_id, invoice_number, invoice_date, vendor_name, taxable_value, cgst, sgst, igst, eligible_itc, ineligible_itc)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            ''', (user_id, inv_num, inv_date, vendor, taxable, cgst, sgst, igst, eligible, ineligible))
            ret_id = cur.fetchone()[0]
            
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            "success": True, 
            "id": ret_id,
            "eligible_itc": eligible,
            "ineligible_itc": ineligible
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/delete-invoice', methods=['POST'])
@login_required
def delete_invoice():
    user_id = session['user_id']
    is_admin = is_admin_user()
    data = request.json
    db_id = data.get('id')

    if not db_id:
        return jsonify({"error": "Invoice ID required"}), 400

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        if is_admin:
            cur.execute('DELETE FROM invoices WHERE id = %s', (db_id,))
        else:
            cur.execute('DELETE FROM invoices WHERE id = %s AND user_id = %s', (db_id, user_id))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/invoice-file/<int:invoice_id>', methods=['GET'])
@login_required
def get_invoice_file(invoice_id):
    user_id = session['user_id']
    is_admin = is_admin_user()
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        if is_admin:
            cur.execute('SELECT file_data, file_mime_type, file_name FROM invoices WHERE id = %s', (invoice_id,))
        else:
            cur.execute('SELECT file_data, file_mime_type, file_name FROM invoices WHERE id = %s AND user_id = %s', (invoice_id, user_id))
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row or row[0] is None:
            return jsonify({"error": "No file attached to this invoice"}), 404

        file_data, mime_type, file_name = row
        return send_file(
            io.BytesIO(bytes(file_data)),
            mimetype=mime_type or "application/octet-stream",
            as_attachment=False,
            download_name=file_name or f"invoice-{invoice_id}"
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/clear-invoices', methods=['POST'])
@login_required
def clear_invoices():
    user_id = session['user_id']
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('DELETE FROM invoices WHERE user_id = %s', (user_id,))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/process-invoices', methods=['POST'])
@login_required
def process_invoices():
    user_id = session['user_id']
    if 'files[]' not in request.files:
        return jsonify({"error": "No files uploaded"}), 400
        
    files = request.files.getlist('files[]')
    results = []
    
    for file in files:
        filename = file.filename
        ext = filename.split('.')[-1].lower()
        file_bytes = file.read()
        
        # Original bill file, stored alongside the extracted invoice for
        # single-invoice sources (PDF/image). Purchase registers (Excel/CSV)
        # produce many invoices per file, so there's no single bill to attach.
        store_file_bytes = None
        store_mime_type = None
        store_file_name = None

        try:
            parsed_list = []
            # 1. Excel/CSV Processing
            if ext in ['xlsx', 'xls', 'csv']:
                if ext == 'csv':
                    df = pd.read_csv(io.BytesIO(file_bytes))
                    out = io.BytesIO()
                    df.to_excel(out, index=False)
                    file_bytes = out.getvalue()

                parsed_list = parse_excel_register(file_bytes)

            # 2. PDF Processing
            elif ext == 'pdf':
                pdf_file = io.BytesIO(file_bytes)
                reader = PdfReader(pdf_file)
                text = ""
                for page in reader.pages:
                    text += page.extract_text() or ""

                if len(text.strip()) > 100:
                    inv = extract_from_text(text)
                else:
                    base64_pdf = base64.b64encode(file_bytes).decode('utf-8')
                    inv = extract_from_pdf_binary(base64_pdf)
                parsed_list = [inv]
                store_file_bytes = file_bytes
                store_mime_type = "application/pdf"
                store_file_name = filename

            # 3. Image Processing
            elif ext in ['png', 'jpg', 'jpeg', 'webp']:
                mime_type = f"image/{ext}"
                if ext == 'jpg': mime_type = "image/jpeg"
                base64_img = base64.b64encode(file_bytes).decode('utf-8')
                inv = extract_from_image(base64_img, mime_type)
                parsed_list = [inv]
                store_file_bytes = file_bytes
                store_mime_type = mime_type
                store_file_name = filename
            
            # Save parsed invoices to Postgres immediately
            conn = get_db_connection()
            cur = conn.cursor()
            for inv in parsed_list:
                inv["invoice_number"] = inv.get("invoice_number") or "N/A"
                inv["invoice_date"] = inv.get("invoice_date") or "N/A"
                inv["vendor_name"] = inv.get("vendor_name") or "Unknown Vendor"
                for field in ("taxable_value", "cgst", "sgst", "igst"):
                    try:
                        inv[field] = float(inv.get(field) or 0.0)
                    except (TypeError, ValueError):
                        inv[field] = 0.0

                total_gst = inv["cgst"] + inv["sgst"] + inv["igst"]
                eligible = round(total_gst * 0.5, 2)
                ineligible = round(total_gst * 0.5, 2)
                
                cur.execute('''
                    INSERT INTO invoices (user_id, invoice_number, invoice_date, vendor_name, taxable_value, cgst, sgst, igst, eligible_itc, ineligible_itc, file_data, file_mime_type, file_name)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
                ''', (user_id, inv["invoice_number"], inv["invoice_date"], inv["vendor_name"],
                      inv["taxable_value"], inv["cgst"], inv["sgst"], inv["igst"],
                      eligible, ineligible,
                      psycopg2.Binary(store_file_bytes) if store_file_bytes else None,
                      store_mime_type, store_file_name))

                db_id = cur.fetchone()[0]
                results.append({
                    "id": db_id,
                    "invoice_number": inv["invoice_number"],
                    "invoice_date": inv["invoice_date"],
                    "vendor_name": inv["vendor_name"],
                    "taxable_value": inv["taxable_value"],
                    "cgst": inv["cgst"],
                    "sgst": inv["sgst"],
                    "igst": inv["igst"],
                    "has_file": store_file_bytes is not None,
                    "eligible_itc": eligible,
                    "ineligible_itc": ineligible,
                    "filename": filename
                })
            conn.commit()
            cur.close()
            conn.close()
                
        except Exception as e:
            print(f"Error processing file {filename}: {e}")
            results.append({
                "id": None,
                "invoice_number": "ERROR",
                "invoice_date": "-",
                "vendor_name": f"Failed to parse {filename}",
                "taxable_value": 0.0,
                "cgst": 0.0,
                "sgst": 0.0,
                "igst": 0.0,
                "eligible_itc": 0.0,
                "ineligible_itc": 0.0,
                "filename": filename
            })

    return jsonify({"invoices": results})

@app.route('/api/export-excel', methods=['POST'])
@login_required
def export_excel():
    data = request.json
    invoices = data.get('invoices', [])
    
    df = pd.DataFrame(invoices)
    
    # Cleanup keys
    for col in ['filename', 'id', 'user_id']:
        if col in df.columns:
            df = df.drop(columns=[col])
        
    column_mapping = {
        "invoice_number": "Invoice Number",
        "invoice_date": "Invoice Date",
        "vendor_name": "Vendor Name",
        "taxable_value": "Taxable Value (INR)",
        "cgst": "CGST (INR)",
        "sgst": "SGST (INR)",
        "igst": "IGST (INR)",
        "eligible_itc": "Eligible ITC (50%)",
        "ineligible_itc": "Ineligible ITC (50%)"
    }
    df = df.rename(columns=column_mapping)
    
    total_row = {
        "Invoice Number": "TOTAL",
        "Invoice Date": "",
        "Vendor Name": "",
        "Taxable Value (INR)": df["Taxable Value (INR)"].sum(),
        "CGST (INR)": df["CGST (INR)"].sum(),
        "SGST (INR)": df["SGST (INR)"].sum(),
        "IGST (INR)": df["IGST (INR)"].sum(),
        "Eligible ITC (50%)": df["Eligible ITC (50%)"].sum(),
        "Ineligible ITC (50%)": df["Ineligible ITC (50%)"].sum()
    }
    
    df = pd.concat([df, pd.DataFrame([total_row])], ignore_index=True)
    output = io.BytesIO()
    
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name="GST ITC Reconciled")
        
        workbook = writer.book
        worksheet = writer.sheets["GST ITC Reconciled"]
        
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        
        navy_header_fill = PatternFill(start_color="0A2540", end_color="0A2540", fill_type="solid")
        total_fill = PatternFill(start_color="E6F4EA", end_color="E6F4EA", fill_type="solid")
        white_font = Font(name="Arial", size=11, bold=True, color="FFFFFF")
        bold_font = Font(name="Arial", size=11, bold=True)
        regular_font = Font(name="Arial", size=10)
        
        thin_border = Border(
            left=Side(style='thin', color='DDDDDD'), right=Side(style='thin', color='DDDDDD'),
            top=Side(style='thin', color='DDDDDD'), bottom=Side(style='thin', color='DDDDDD')
        )
        
        double_bottom_border = Border(
            top=Side(style='thin', color='000000'), bottom=Side(style='double', color='000000')
        )
        
        for col_idx in range(1, len(df.columns) + 1):
            cell = worksheet.cell(row=1, column=col_idx)
            cell.fill = navy_header_fill
            cell.font = white_font
            cell.alignment = Alignment(horizontal="center", vertical="center")
            
        max_row = worksheet.max_row
        for row_idx in range(2, max_row):
            for col_idx in range(1, len(df.columns) + 1):
                cell = worksheet.cell(row=row_idx, column=col_idx)
                cell.font = regular_font
                cell.border = thin_border
                
                if col_idx >= 4:
                    cell.alignment = Alignment(horizontal="right")
                    cell.number_format = '#,##0.00'
                else:
                    cell.alignment = Alignment(horizontal="left")
                    
        for col_idx in range(1, len(df.columns) + 1):
            cell = worksheet.cell(row=max_row, column=col_idx)
            cell.font = bold_font
            cell.fill = total_fill
            cell.border = double_bottom_border
            if col_idx >= 4:
                cell.alignment = Alignment(horizontal="right")
                cell.number_format = '#,##0.00'
                
        for col in worksheet.columns:
            max_len = 0
            col_letter = col[0].column_letter
            for cell in col:
                val_to_check = str(cell.value or '')
                if cell.number_format == '#,##0.00' and isinstance(cell.value, (int, float)):
                    val_to_check = f"{cell.value:,.2f}"
                max_len = max(max_len, len(val_to_check))
            worksheet.column_dimensions[col_letter].width = max(max_len + 3, 12)
            
    output.seek(0)

    return send_file(
        output,
        as_attachment=True,
        download_name="GST_ITC_Reconciled_Sheet.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

if __name__ == '__main__':
    # Ensure static and template folders exist
    os.makedirs(app.static_folder, exist_ok=True)
    os.makedirs(app.template_folder, exist_ok=True)
    
    # Initialize DB Tables
    init_db()
    
    # Run server
    port = int(os.getenv("PORT", 5588))
    print(f"Starting GST Calculation Server on port {port}...")
    app.run(host='0.0.0.0', port=port, debug=True)
