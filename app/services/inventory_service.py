"""Inventory Management & Google Drive File-ID Catalogue Sync Service.

Business Rule (Section 11):
- For Google Drive-controlled saree catalogue items (`is_drive_controlled = 1`),
  uploading an image in Drive represents available stock, and removing the source
  image marks the associated physical saree as `unavailable`.
- Stable product identities are preserved using `drive_file_id` (never generates duplicate SKUs).
- Unrelated non-Drive inventory items and historical sales records are NEVER touched.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status

from app.db import Database
from app.formatting import format_inr, to_decimal
from app.security import AuthContext, write_audit_log


def list_inventory(
    db: Database,
    branch_ids: Optional[List[int]],
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
) -> Dict[str, Any]:
    clauses = ["1=1"]
    params: List[Any] = []
    if branch_ids is not None:
        ph = ",".join("?" for _ in branch_ids)
        clauses.append(f"i.branch_id IN ({ph})")
        params.extend(branch_ids)
    if status_filter and status_filter != "all":
        clauses.append("i.status = ?")
        params.append(status_filter)
    if search:
        like = f"%{search.strip()}%"
        clauses.append("(i.sku LIKE ? OR i.product_name LIKE ? OR i.fabric_category LIKE ? OR i.design_category LIKE ?)")
        params.extend([like, like, like, like])

    with db.connection() as conn:
        rows = db.fetch_all(
            conn,
            f"""
            SELECT i.id, i.sku, i.product_name, i.fabric_category, i.design_category,
                   i.mrp, i.branch_id, b.name AS branch_name, i.status,
                   i.quantity_available, i.quantity_reserved, i.quantity_sold,
                   i.is_drive_controlled, i.drive_file_id, i.updated_at,
                   (SELECT image_url FROM product_images pi WHERE pi.inventory_item_id = i.id LIMIT 1) AS image_url
            FROM inventory_items i
            JOIN branches b ON b.id = i.branch_id
            WHERE {' AND '.join(clauses)}
            ORDER BY i.id DESC
            """,
            params,
        )

    items = [{**r, "mrp_formatted": format_inr(r["mrp"])} for r in rows]
    summary = {
        "total_skus": len(items),
        "available_qty": sum(int(i["quantity_available"]) for i in items),
        "reserved_qty": sum(int(i["quantity_reserved"]) for i in items),
        "sold_qty": sum(int(i["quantity_sold"]) for i in items),
        "drive_controlled_skus": sum(1 for i in items if i["is_drive_controlled"]),
    }
    return {"summary": summary, "items": items}


def create_inventory_item(
    db: Database,
    auth: AuthContext,
    payload: Dict[str, Any],
    ip_address: Optional[str] = None,
) -> Dict[str, Any]:
    sku = str(payload.get("sku", "")).strip().upper()
    name = str(payload.get("product_name", "")).strip()
    branch_id = int(payload.get("branch_id", 1))
    if not sku or not name:
        raise HTTPException(status_code=400, detail="SKU and product_name are required")
    if not auth.all_branches and branch_id not in auth.allowed_branch_ids:
        raise HTTPException(status_code=403, detail="Branch access denied")

    mrp = to_decimal(payload.get("mrp", 0))
    qty = max(0, int(payload.get("quantity_available", 1)))
    item_status = "available" if qty > 0 else "unavailable"

    with db.connection() as conn:
        dup = db.fetch_one(conn, "SELECT id FROM inventory_items WHERE sku = ?", (sku,))
        if dup:
            raise HTTPException(status_code=409, detail=f"SKU '{sku}' already exists")

        item_id = db.insert_returning_id(
            conn,
            """
            INSERT INTO inventory_items (
                sku, product_name, fabric_category, design_category, mrp,
                branch_id, status, quantity_available, quantity_reserved, quantity_sold,
                is_drive_controlled
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, FALSE)
            """,
            (
                sku,
                name,
                str(payload.get("fabric_category", "")).strip(),
                str(payload.get("design_category", "")).strip(),
                f"{mrp:.2f}",
                branch_id,
                item_status,
                qty,
            ),
        )
        db.execute(
            conn,
            """
            INSERT INTO stock_movements (
                inventory_item_id, movement_type, to_branch_id, quantity_delta, reference_note, performed_by
            ) VALUES (?, 'intake', ?, ?, ?, ?)
            """,
            (item_id, branch_id, qty, "Initial stock intake", auth.user_id),
        )
        write_audit_log(
            db,
            conn,
            actor_user_id=auth.user_id,
            actor_role=auth.role_code,
            action="create_inventory_item",
            entity_type="inventory_item",
            entity_id=str(item_id),
            branch_id=branch_id,
            ip_address=ip_address,
            after_state={"sku": sku, "qty": qty},
        )
    return {"id": item_id, "sku": sku, "status": item_status}


def move_or_transfer_stock(
    db: Database,
    auth: AuthContext,
    item_id: int,
    movement_type: str,
    quantity: int,
    to_branch_id: Optional[int] = None,
    note: str = "",
    ip_address: Optional[str] = None,
) -> Dict[str, Any]:
    valid_types = {"transfer", "reserve", "release", "sale", "adjustment"}
    if movement_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid movement_type '{movement_type}'")
    if quantity <= 0 and movement_type != "adjustment":
        raise HTTPException(status_code=400, detail="Quantity must be positive")

    now_iso = datetime.now(timezone.utc).isoformat()
    with db.connection() as conn:
        item = db.fetch_one(conn, "SELECT * FROM inventory_items WHERE id = ?", (item_id,))
        if not item:
            raise HTTPException(status_code=404, detail="Inventory item not found")
        if not auth.all_branches and int(item["branch_id"]) not in auth.allowed_branch_ids:
            raise HTTPException(status_code=403, detail="Branch access denied")

        avail = int(item["quantity_available"])
        resv = int(item["quantity_reserved"])
        sold = int(item["quantity_sold"])
        cur_branch = int(item["branch_id"])
        new_branch = cur_branch
        delta = quantity

        if movement_type == "transfer":
            if not to_branch_id or to_branch_id == cur_branch:
                raise HTTPException(status_code=400, detail="Valid destination branch_id is required for transfer")
            new_branch = int(to_branch_id)
        elif movement_type == "reserve":
            if quantity > avail:
                raise HTTPException(status_code=400, detail="Insufficient available stock to reserve")
            avail -= quantity
            resv += quantity
            delta = -quantity
        elif movement_type == "release":
            if quantity > resv:
                raise HTTPException(status_code=400, detail="Release quantity exceeds reserved stock")
            resv -= quantity
            avail += quantity
        elif movement_type == "sale":
            if quantity > avail:
                raise HTTPException(status_code=400, detail="Insufficient available stock for sale")
            avail -= quantity
            sold += quantity
            delta = -quantity
        elif movement_type == "adjustment":
            avail = max(0, avail + quantity)

        new_status = "available" if avail > 0 else ("reserved" if resv > 0 else ("sold" if sold > 0 else "unavailable"))
        db.execute(
            conn,
            """
            UPDATE inventory_items
            SET branch_id = ?, quantity_available = ?, quantity_reserved = ?,
                quantity_sold = ?, status = ?, updated_at = ?
            WHERE id = ?
            """,
            (new_branch, avail, resv, sold, new_status, now_iso, item_id),
        )
        db.execute(
            conn,
            """
            INSERT INTO stock_movements (
                inventory_item_id, movement_type, from_branch_id, to_branch_id,
                quantity_delta, reference_note, performed_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (item_id, movement_type, cur_branch, new_branch, delta, note, auth.user_id),
        )
        write_audit_log(
            db,
            conn,
            actor_user_id=auth.user_id,
            actor_role=auth.role_code,
            action=f"stock_{movement_type}",
            entity_type="inventory_item",
            entity_id=str(item_id),
            branch_id=new_branch,
            ip_address=ip_address,
            before_state={"branch_id": cur_branch, "available": item["quantity_available"], "reserved": item["quantity_reserved"]},
            after_state={"branch_id": new_branch, "available": avail, "reserved": resv, "sold": sold, "status": new_status},
        )
    return {"id": item_id, "branch_id": new_branch, "quantity_available": avail, "quantity_reserved": resv, "quantity_sold": sold, "status": new_status}


def sync_google_drive_catalogue(
    db: Database,
    auth: AuthContext,
    branch_id: int,
    drive_files: List[Dict[str, Any]],
    ip_address: Optional[str] = None,
) -> Dict[str, Any]:
    """Synchronize Google Drive-controlled saree catalogue by stable drive_file_id.

    - Present file in Drive -> available saree (creates once; never duplicates SKU).
    - Removed file from Drive -> marks ONLY matching `is_drive_controlled=1` item unavailable.
    - Non-Drive inventory items and historical sales are untouched.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    seen_ids = set()
    created = 0
    restored = 0
    marked_unavailable = 0

    with db.connection() as conn:
        for f in drive_files:
            file_id = str(f.get("file_id", "")).strip()
            file_name = str(f.get("file_name", "")).strip()
            image_url = str(f.get("image_url", "")).strip() or f"https://drive.google.com/uc?id={file_id}"
            if not file_id:
                continue
            seen_ids.add(file_id)

            existing = db.fetch_one(conn, "SELECT * FROM inventory_items WHERE drive_file_id = ?", (file_id,))
            if existing:
                if existing["status"] == "unavailable":
                    db.execute(
                        conn,
                        "UPDATE inventory_items SET status = 'available', quantity_available = 1, updated_at = ? WHERE id = ?",
                        (now_iso, existing["id"]),
                    )
                    restored += 1
                db.execute(
                    conn,
                    "UPDATE product_images SET is_present_in_drive = TRUE, last_verified_at = ? WHERE drive_file_id = ?",
                    (now_iso, file_id),
                )
            else:
                clean_stem = file_name.rsplit(".", 1)[0] if "." in file_name else (file_name or file_id[:10])
                sku = f"KK-DRV-{hashlib.sha256(file_id.encode()).hexdigest()[:12].upper()}"
                mrp = to_decimal(f.get("mrp", 0))
                item_id = db.insert_returning_id(
                    conn,
                    """
                    INSERT INTO inventory_items (
                        sku, product_name, fabric_category, design_category, mrp,
                        branch_id, status, quantity_available, quantity_reserved, quantity_sold,
                        is_drive_controlled, drive_file_id
                    ) VALUES (?, ?, ?, ?, ?, ?, 'available', 1, 0, 0, TRUE, ?)
                    """,
                    (
                        sku,
                        clean_stem,
                        str(f.get("fabric_category", "Kalamkari Saree")),
                        str(f.get("design_category", "Drive Catalogue")),
                        f"{mrp:.2f}",
                        branch_id,
                        file_id,
                    ),
                )
                db.execute(
                    conn,
                    """
                    INSERT INTO product_images (inventory_item_id, drive_file_id, image_url, file_name, is_present_in_drive, last_verified_at)
                    VALUES (?, ?, ?, ?, TRUE, ?)
                    """,
                    (item_id, file_id, image_url, file_name, now_iso),
                )
                db.execute(
                    conn,
                    """
                    INSERT INTO stock_movements (inventory_item_id, movement_type, to_branch_id, quantity_delta, reference_note, performed_by)
                    VALUES (?, 'intake', ?, 1, 'Google Drive catalogue image added', ?)
                    """,
                    (item_id, branch_id, auth.user_id),
                )
                created += 1

        # Mark Drive-controlled items whose image was removed as unavailable (never touch non-Drive items)
        drive_items = db.fetch_all(
            conn,
            "SELECT id, drive_file_id, status FROM inventory_items WHERE is_drive_controlled = TRUE AND branch_id = ?",
            (branch_id,),
        )
        for di in drive_items:
            if di["drive_file_id"] not in seen_ids and di["status"] == "available":
                db.execute(
                    conn,
                    "UPDATE inventory_items SET status = 'unavailable', quantity_available = 0, updated_at = ? WHERE id = ?",
                    (now_iso, di["id"]),
                )
                db.execute(
                    conn,
                    "UPDATE product_images SET is_present_in_drive = FALSE, last_verified_at = ? WHERE inventory_item_id = ?",
                    (now_iso, di["id"]),
                )
                db.execute(
                    conn,
                    """
                    INSERT INTO stock_movements (inventory_item_id, movement_type, from_branch_id, quantity_delta, reference_note, performed_by)
                    VALUES (?, 'drive_removed', ?, -1, 'Source image removed from Google Drive catalogue', ?)
                    """,
                    (di["id"], branch_id, auth.user_id),
                )
                marked_unavailable += 1

        write_audit_log(
            db,
            conn,
            actor_user_id=auth.user_id,
            actor_role=auth.role_code,
            action="sync_drive_catalogue",
            entity_type="inventory",
            entity_id=f"branch:{branch_id}",
            branch_id=branch_id,
            ip_address=ip_address,
            after_state={"created": created, "restored": restored, "marked_unavailable": marked_unavailable},
        )
    return {"created": created, "restored": restored, "marked_unavailable": marked_unavailable}
