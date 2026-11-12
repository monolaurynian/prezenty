# Running Prezenty on an Oracle Cloud VM

App and database on one machine: no sleeping, no database round trip over the
internet, and the database port is never open to the outside. Caddy in front
gives HTTPS (the session cookie is `secure`, so the app only works over HTTPS).

The scripts here were written without access to a real Oracle VM. Run them
once, read the output, and stop at the first error.

## Before you start

- **Domain.** Pick a name for the app, e.g. `prezenty.<your-domain>`. You will
  point it at the VM in Hostinger's DNS (an `A` record). Do not touch the
  current record until step 8.
- **A fresh dump** of the old database (phpMyAdmin > Export > Custom > SQL).
  Nothing has been written to it since the outage, so it is complete.
  Keep it OUTSIDE the project folder (the repo is pushed automatically).

## Oracle's free-tier rules that matter

- An Always Free tenancy gets **2 Arm OCPUs and 12 GB RAM in total**
  (VM.Standard.A1.Flex), or up to two 1 GB AMD micro VMs
  (VM.Standard.E2.1.Micro). Use one A1 instance with 2 OCPUs / 12 GB.
- **Idle instances may be reclaimed.** Oracle treats an instance as idle when
  in 7 days its 95th-percentile CPU is below 20%, network is below 20%, and (A1
  only) memory is below 20%. A family app will be under that. Upgrading the
  account to **Pay As You Go** is the usual way to avoid reclamation (Oracle
  says it still charges nothing for Always Free resources; I did not find the
  exemption stated in their docs, so check "Idle Compute Instances" in the
  Always Free page). Then set a **budget alert at $1** so a mistake cannot
  cost money quietly.
- "Out of host capacity" is normal for Arm: try another availability domain,
  retry later, or use the AMD micro VM (1 GB RAM, 1/8 of a core: enough for
  this app; setup adds 2 GB of swap and a small MariaDB profile when RAM is
  under 2 GB, updates are slow). To move to Arm later, restore a backup on the
  new VM and change the DNS record.
- The **home region cannot be changed** after sign-up. For users in Poland
  choose **Germany Central (Frankfurt)**.

## Steps

1. **Sign up** at oracle.com/cloud/free, home region Frankfurt. A card is
   needed for verification. Upgrade to Pay As You Go (see above) and add the
   $1 budget alert.
2. **Create the VM** (Compute > Instances > Create):
   image **Ubuntu 24.04** (Arm build for A1), shape `VM.Standard.A1.Flex`
   with 2 OCPUs / 12 GB, a public IPv4 address, and your SSH public key
   (`ssh-keygen -t ed25519` on your PC, paste the `.pub` file).
3. **Open ports 80 and 443** in the VM's network: Networking > Virtual cloud
   networks > your VCN > Security Lists > Default > Add Ingress Rules:
   source `0.0.0.0/0`, TCP, destination ports `80,443`. **Do not open 3306.**
4. **Set the DNS record:** in Hostinger > Domains > DNS, add an `A` record for
   your chosen name with the VM's public IP (TTL 300).
5. **Install everything.** Once this folder is on GitHub:
   ```
   ssh ubuntu@<vm-ip>
   curl -fsSL https://raw.githubusercontent.com/monolaurynian/prezenty/main/deploy/oracle/setup-vm.sh -o setup-vm.sh
   sudo bash setup-vm.sh prezenty.<your-domain>
   ```
6. **Import the data.** Copy the dump over (`scp dump.sql ubuntu@<vm-ip>:`), then:
   ```
   grep -nE '^(CREATE DATABASE|USE |.*DEFINER)' dump.sql | head   # should print nothing
   sudo mariadb prezenty < dump.sql
   sudo mariadb prezenty -e "SHOW TABLES; SELECT COUNT(*) FROM users;"
   ```
   If the dump has `USE`/`CREATE DATABASE` lines, delete them first. If it
   has `DEFINER=` clauses (views/triggers), remove them with
   `sed -i 's/DEFINER=[^ ]* //g' dump.sql`. If the import complains about an
   unknown collation `utf8mb4_uca1400_*`:
   `sed -i 's/utf8mb4_uca1400_ai_ci/utf8mb4_unicode_ci/g' dump.sql`.
7. **Start and check:**
   ```
   sudo systemctl start prezenty
   curl -s http://127.0.0.1:3000/health
   sudo journalctl -u prezenty -n 40 --no-pager     # no MAINTENANCE MODE line
   ```
   Add the GIF keys to `/etc/prezenty/prezenty.env` (copy `KLIPY_API_KEY` from
   Render), then `sudo systemctl restart prezenty`. Open
   `https://prezenty.<your-domain>`, log in, send a chat message and a GIF,
   check a profile picture.
   Everyone is logged out once (new `SESSION_SECRET`).
8. **Cut over** (only when step 7 works): point the real domain's DNS at the
   VM (or change the app's address everywhere you shared it). Keep Render
   running a few days as a fallback, then suspend it.
9. **Off-machine backup.** The nightly dump stays on the VM, so about weekly
   copy one to your PC:
   `scp ubuntu@<vm-ip>:/var/backups/prezenty/prezenty_<date>.sql.gz .`
   (store it outside the repo).

## Deploys from GitHub

A systemd timer (`prezenty-deploy.timer`) checks GitHub every 5 minutes. When
`main` has a new commit it pulls it, installs dependencies only if
`package.json` / `package-lock.json` changed, restarts the app and waits for
`/health` to answer `OK`. If it does not, it goes back to the previous commit,
restarts, and skips the broken commit until a newer one arrives.

- Anything pushed to `main` goes live within about 5 minutes, including
  half-finished work pushed by an automatic sync. To stop that, switch the
  timer to a `production` branch: set `Environment=DEPLOY_BRANCH=production`
  in `prezenty-deploy.service` and push to that branch when ready.
- Watch it: `sudo journalctl -u prezenty-deploy -f`
- Deploy right now: `sudo /opt/prezenty/app/deploy/oracle/update.sh`
- Pause it: `sudo systemctl stop prezenty-deploy.timer` (start it again with `start`)
- Enable it on a VM set up before this existed: run `update.sh` once to pull
  the new files, then `sudo bash /opt/prezenty/app/deploy/oracle/install-auto-deploy.sh`.
- It does not change the system files setup-vm.sh installed (service unit,
  Caddyfile): if those change, run `setup-vm.sh` again.

## Day to day

- Logs: `sudo journalctl -u prezenty -f`
- Restart: `sudo systemctl restart prezenty`
- Restore a backup: `gunzip -c prezenty_<date>.sql.gz | sudo mariadb prezenty`
- Security updates install themselves (unattended-upgrades).

## After the move

- `render.yaml` and the keep-alive cron (it only runs on Render) can go once
  you are sure you will not go back.
- The app still runs on the push-notification keys that ship in the repo,
  which are public. Rotating them (DEPLOYMENT.md "Rotating secrets") makes every
  device subscribe to notifications again, so do it when convenient.
- The VM reads its database settings from `/etc/prezenty/prezenty.env`
  (`DB_HOST=127.0.0.1`); the defaults inside the code and `render.yaml` are
  not used there.
