"""Shared FastAPI dependencies for route authorization."""

import os

from fastapi import Header, HTTPException


async def verify_admin_token(authorization: str = Header(default="")):
    """Verify admin token from Authorization header."""
    expected = os.getenv("ADMIN_TOKEN", "")
    if not expected:
        return  # No token configured = auth disabled (dev mode)
    token = (
        authorization.replace("Bearer ", "")
        if authorization.startswith("Bearer ")
        else authorization
    )
    if token != expected:
        raise HTTPException(status_code=401, detail="Invalid admin token")
