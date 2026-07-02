"""
SSL certificate management API for pktHub.
Certs live at /etc/ssl/pktsuite/cert.pem + key.pem (actual server path, not renamed).
"""
import os, subprocess, tempfile, datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from app.auth import require_admin

CERT_DIR  = "/etc/ssl/pktsuite"
CERT_PATH = f"{CERT_DIR}/cert.pem"
KEY_PATH  = f"{CERT_DIR}/key.pem"

router = APIRouter(prefix="/api/ssl", tags=["ssl"])


def _cert_info() -> dict:
    """Parse installed cert metadata using openssl CLI."""
    if not os.path.exists(CERT_PATH):
        return {"installed": False}
    try:
        def openssl(*args):
            r = subprocess.run(["openssl"] + list(args), capture_output=True, text=True, timeout=5)
            return r.stdout.strip()

        subject  = openssl("x509", "-in", CERT_PATH, "-noout", "-subject")
        issuer   = openssl("x509", "-in", CERT_PATH, "-noout", "-issuer")
        end_date = openssl("x509", "-in", CERT_PATH, "-noout", "-enddate")

        expires_str = end_date.replace("notAfter=", "").strip()
        expires_dt  = datetime.datetime.strptime(expires_str, "%b %d %H:%M:%S %Y %Z")
        days_left   = (expires_dt - datetime.datetime.utcnow()).days

        return {
            "installed": True,
            "subject":  subject.replace("subject=", "").strip(),
            "issuer":   issuer.replace("issuer=", "").strip(),
            "expires":  expires_dt.strftime("%Y-%m-%d"),
            "days_until_expiry": days_left,
        }
    except Exception as e:
        return {"installed": True, "error": str(e)}


@router.get("/status")
async def ssl_status(_=Depends(require_admin)):
    return _cert_info()


@router.post("/upload")
async def upload_pem(
    cert_file: UploadFile = File(...),
    key_file:  UploadFile = File(...),
    _=Depends(require_admin),
):
    """Accept PEM cert + key, validate, install."""
    cert_data = await cert_file.read()
    key_data  = await key_file.read()

    # Quick sanity check
    if b"BEGIN CERTIFICATE" not in cert_data:
        raise HTTPException(400, "cert_file does not appear to be a PEM certificate")
    if b"BEGIN" not in key_data or b"PRIVATE KEY" not in key_data:
        raise HTTPException(400, "key_file does not appear to be a PEM private key")

    os.makedirs(CERT_DIR, exist_ok=True)
    with open(CERT_PATH, "wb") as f: f.write(cert_data)
    with open(KEY_PATH,  "wb") as f: f.write(key_data)
    os.chmod(CERT_PATH, 0o644)
    os.chmod(KEY_PATH,  0o600)

    return _cert_info()


@router.post("/upload-pfx")
async def upload_pfx(
    pfx_file:   UploadFile = File(...),
    passphrase: str        = Form(...),
    _=Depends(require_admin),
):
    """Accept PFX/P12, convert to PEM using openssl, install."""
    pfx_data = await pfx_file.read()

    with tempfile.TemporaryDirectory() as tmp:
        pfx_path  = os.path.join(tmp, "upload.pfx")
        cert_tmp  = os.path.join(tmp, "cert.pem")
        key_tmp   = os.path.join(tmp, "key.pem")

        with open(pfx_path, "wb") as f:
            f.write(pfx_data)

        # Extract cert
        r = subprocess.run([
            "openssl", "pkcs12", "-in", pfx_path,
            "-clcerts", "-nokeys", "-out", cert_tmp,
            "-password", f"pass:{passphrase}", "-legacy"
        ], capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            # retry without -legacy (older openssl)
            r = subprocess.run([
                "openssl", "pkcs12", "-in", pfx_path,
                "-clcerts", "-nokeys", "-out", cert_tmp,
                "-password", f"pass:{passphrase}"
            ], capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            raise HTTPException(400, f"PFX extraction failed: {r.stderr.strip()}")

        # Extract key (no passphrase on output)
        r = subprocess.run([
            "openssl", "pkcs12", "-in", pfx_path,
            "-nocerts", "-nodes", "-out", key_tmp,
            "-password", f"pass:{passphrase}", "-legacy"
        ], capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            r = subprocess.run([
                "openssl", "pkcs12", "-in", pfx_path,
                "-nocerts", "-nodes", "-out", key_tmp,
                "-password", f"pass:{passphrase}"
            ], capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            raise HTTPException(400, f"PFX key extraction failed: {r.stderr.strip()}")

        os.makedirs(CERT_DIR, exist_ok=True)
        with open(CERT_PATH, "wb") as f: f.write(open(cert_tmp, "rb").read())
        with open(KEY_PATH,  "wb") as f: f.write(open(key_tmp,  "rb").read())
        os.chmod(CERT_PATH, 0o644)
        os.chmod(KEY_PATH,  0o600)

    return _cert_info()


@router.delete("/", status_code=204)
async def delete_ssl(_=Depends(require_admin)):
    for p in (CERT_PATH, KEY_PATH):
        if os.path.exists(p):
            os.remove(p)
