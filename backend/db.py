"""MongoDB connection for SPOT Cloud.

Singleton connection that all routes share. Uses MONGO_URL and DB_NAME from .env.
"""
import os
from motor.motor_asyncio import AsyncIOMotorClient

_mongo_url = os.environ['MONGO_URL']
_db_name = os.environ['DB_NAME']

client = AsyncIOMotorClient(_mongo_url)
db = client[_db_name]


# Collection names (single source of truth)
COL_USERS = "users"
COL_QUOTE_DRAFTS = "quote_drafts"
COL_QUOTES = "quotes"
COL_CUSTOMERS = "customers"
COL_AUDIT_LOG = "audit_log"
COL_PARSER_BUDGET = "parser_budget"
COL_RATE_OVERRIDES = "rate_overrides"
COL_SHEET_OVERRIDES = "sheet_overrides"
COL_SHIPTO_HISTORY = "shipto_history"
COL_CALIBRATION_LOCK = "calibration_lock"
COL_FILES = "fs.files"  # GridFS files collection
COL_INTEGRATIONS = "integrations"      # Anthropic / UTS keys (masked, audit-logged)
COL_PARSER_USAGE = "parser_usage"      # Per-parse-call usage log (tokens, $, customer)
COL_SHEETS = "sheet_library"           # Admin-managed sheet adds / edits / disables
COL_BOM_TEMPLATES = "bom_templates"    # Personal + team BOM templates
