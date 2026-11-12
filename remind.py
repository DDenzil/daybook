"""Daybook reminder runner.

Runs inside the private data repo on a GitHub Actions schedule. Reads the CSVs in data/,
works out what is due right now, and sends Web Push notifications to every device listed
in data/push.json. Each reminder is recorded in data/sent.csv so it is only sent once.

Env:
  MODE=auto|test   test sends one test notification and nothing else
  DRY_RUN=1        print what would be sent; send nothing, write nothing
  NOW=YYYY-MM-DDTHH:MM   pretend it is this local time (testing)
"""
import csv
import json
import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]  # Python weekday() order
STALE = timedelta(hours=2)  # never send a reminder more than 2 h after its time
DRY = os.environ.get("DRY_RUN") == "1"


def path(name):
    return os.path.join(DATA, name)


def read_csv(name):
    p = path(name)
    if not os.path.exists(p):
        return []
    with open(p, newline="", encoding="utf-8-sig") as f:
        return [{k.strip(): (v or "") for k, v in row.items() if k} for row in csv.DictReader(f)]


def write_csv(name, cols, rows):
    with open(path(name), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})


def hm_to_dt(day, hm):
    try:
        h, m = (int(x) for x in hm.split(":")[:2])
    except (ValueError, AttributeError):
        return None
    return day.replace(hour=h, minute=m, second=0, microsecond=0)


def fmt_time(hm):
    h, m = (int(x) for x in hm.split(":")[:2])
    return f"{(h + 11) % 12 + 1}:{m:02d} {'PM' if h >= 12 else 'AM'}"


def main():
    settings = {r["key"]: r["value"] for r in read_csv("settings.csv")}
    tz = ZoneInfo(settings.get("timezone") or "Asia/Qatar")
    now = datetime.fromisoformat(os.environ["NOW"]).replace(tzinfo=tz) if os.environ.get("NOW") else datetime.now(tz)
    today = now.strftime("%Y-%m-%d")
    mode = (os.environ.get("MODE") or "auto").strip().lower()

    push_path = path("push.json")
    if not os.path.exists(push_path):
        print("No devices registered yet (data/push.json missing). Turn on notifications in the app.")
        return
    with open(push_path, encoding="utf-8") as f:
        push = json.load(f)
    subs = push.get("subscriptions") or []
    if not subs or not push.get("vapid"):
        print("No subscriptions in data/push.json.")
        return

    messages = []  # (key, payload)
    if mode == "test":
        messages.append((None, {"title": "Daybook", "body": "Test notification. Reminders are working.", "tag": "test"}))
    else:
        messages = due_messages(settings, now, today)

    if not messages:
        print(f"{now:%Y-%m-%d %H:%M} — nothing due.")
        return

    sent_rows = read_csv("sent.csv")
    dead = set()
    for key, payload in messages:
        print(f"→ {payload['title']}: {payload['body']}")
        if DRY:
            continue
        delivered = False
        for s in subs:
            if s["endpoint"] in dead:
                continue
            ok, gone = send(s, payload, push)
            delivered = delivered or ok
            if gone:
                dead.add(s["endpoint"])
        if key and delivered:
            sent_rows.append({"date": today, "key": key})

    if DRY:
        return
    # keep a week of history
    cutoff = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    write_csv("sent.csv", ["date", "key"], [r for r in sent_rows if r.get("date", "") >= cutoff])
    if dead:
        push["subscriptions"] = [s for s in subs if s["endpoint"] not in dead]
        with open(push_path, "w", encoding="utf-8") as f:
            json.dump(push, f, indent=2)
            f.write("\n")
        print(f"Removed {len(dead)} expired device subscription(s).")


def due_messages(settings, now, today):
    tasks = read_csv("tasks.csv")
    log = {(r.get("date"), r.get("id")) for r in read_csv("log.csv")}
    sent = {r.get("key") for r in read_csv("sent.csv") if r.get("date") == today}
    weekend = (settings.get("weekend") or "Fri Sat").split()
    lead = timedelta(minutes=int(settings.get("lead") or 15))
    dayname = DAY[now.weekday()]
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)

    def scheduled(t):
        if t.get("kind") != "routine" or t.get("status") == "paused":
            return False
        if t.get("created") and t["created"] > today:
            return False
        rep = t.get("repeat") or "daily"
        if rep == "weekdays":
            return dayname not in weekend
        if rep == "weekends":
            return dayname in weekend
        if rep == "custom":
            return dayname in (t.get("days") or "").split()
        return True

    routines = [t for t in tasks if scheduled(t)]
    routines_open = [t for t in routines if (today, t["id"]) not in log]
    tasks_today = [t for t in tasks if t.get("kind") == "task" and t.get("status") != "done" and t.get("due") == today]
    overdue = [t for t in tasks if t.get("kind") == "task" and t.get("status") != "done" and t.get("due") and t["due"] < today]

    def window(at, early=timedelta(0)):
        """True when `at` (minus `early`) has arrived but is not stale."""
        return at is not None and at - early <= now <= at + STALE

    out = []

    # Morning summary
    digest_at = hm_to_dt(midnight, settings.get("digest") or "06:30")
    if "digest" not in sent and window(digest_at):
        parts = []
        if routines:
            parts.append(f"{len(routines)} routine item{'s' * (len(routines) != 1)}")
        if tasks_today:
            parts.append(f"{len(tasks_today)} task{'s' * (len(tasks_today) != 1)} due")
        if overdue:
            parts.append(f"{len(overdue)} overdue")
        timed = sorted([t for t in routines_open + tasks_today if t.get("time") and hm_to_dt(midnight, t["time"]) and hm_to_dt(midnight, t["time"]) >= now], key=lambda t: t["time"])
        body = " · ".join(parts) if parts else "Nothing scheduled today."
        if timed:
            body += f"\nFirst up: {timed[0]['title']} at {fmt_time(timed[0]['time'])}"
        out.append(("digest", {"title": "Today", "body": body, "tag": "digest"}))

    # Timed items
    for t in sorted(routines_open + tasks_today, key=lambda t: t.get("time") or "99:99"):
        if t.get("remind") == "0" or not t.get("time"):
            continue
        key = f"item:{t['id']}"
        at = hm_to_dt(midnight, t["time"])
        if key in sent or not window(at, lead):
            continue
        when = fmt_time(t["time"])
        lead_note = "now" if now >= at else f"at {when}"
        out.append((key, {"title": t["title"], "body": f"{t.get('category') or 'Reminder'} · {lead_note}", "tag": key}))

    # Evening wrap-up
    wrap_at = hm_to_dt(midnight, settings.get("wrap") or "21:00")
    if "wrap" not in sent and window(wrap_at):
        still = routines_open + tasks_today
        if still:
            names = ", ".join(t["title"] for t in still[:4]) + ("…" if len(still) > 4 else "")
            body = f"{len(still)} still open: {names}"
        else:
            body = "Everything for today is done. Nice work."
        out.append(("wrap", {"title": "Evening wrap-up", "body": body, "tag": "wrap"}))
    return out


def send(sub, payload, push):
    """Returns (delivered, subscription_gone)."""
    from pywebpush import WebPushException, webpush

    try:
        webpush(
            subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]},
            data=json.dumps(payload),
            vapid_private_key=push["vapid"]["privateKey"],
            vapid_claims={"sub": push.get("contact") or "https://github.com"},
            ttl=3600,
            headers={"Urgency": "high"},
        )
        return True, False
    except WebPushException as e:
        status = getattr(e.response, "status_code", None)
        print(f"  push failed ({status}): {e}", file=sys.stderr)
        return False, status in (404, 410)


if __name__ == "__main__":
    main()
