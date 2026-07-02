import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r"C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("172.23.80.5", username="ec2-user", pkey=key, timeout=15, banner_timeout=15)

# Stop the crash loop first, run manually to see error
_, stdout, stderr = client.exec_command(
    "sudo systemctl stop pkthub; sleep 1; "
    "cd /mnt/software/pkthub && /mnt/software/pkthub/venv/bin/python -m uvicorn app.main:app "
    "--host 0.0.0.0 --port 8760 "
    "--ssl-certfile /etc/ssl/pkthub/cert.pem "
    "--ssl-keyfile /etc/ssl/pkthub/key.pem 2>&1 &"
    " sleep 5 && cat /mnt/software/logs/pkthub.log | tail -60",
    timeout=30
)
out = stdout.read().decode("utf-8", errors="replace")
err = stderr.read().decode("utf-8", errors="replace")
print("STDOUT:", out[:4000])
print("STDERR:", err[:2000])

# Also try running inline to catch immediate errors
_, stdout2, stderr2 = client.exec_command(
    "cd /mnt/software/pkthub && timeout 8 /mnt/software/pkthub/venv/bin/python -c "
    "'from app.main import app; print(\"import OK\")'  2>&1",
    timeout=20
)
print("\nIMPORT TEST:", stdout2.read().decode("utf-8", errors="replace"))
print("ERR:", stderr2.read().decode("utf-8", errors="replace"))

client.close()
