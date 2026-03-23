'use strict';

/**
 * respond — Consistent API response envelope helpers
 *
 * Every response follows one of two shapes:
 *
 *   Success:
 *   {
 *     "success": true,
 *     "data": { ... },
 *     "meta": { ... }   ← optional (pagination, timing)
 *   }
 *
 *   Error:
 *   {
 *     "success": false,
 *     "error": {
 *       "code":    "MACHINE_READABLE_CODE",
 *       "message": "Human readable description",
 *       "details": [ ... ]   ← optional (validation errors)
 *     }
 *   }
 *
 * Using these helpers guarantees no controller accidentally shapes
 * a response differently.
 */

const respond = {

  /**
   * 200 OK — standard success
   *
   * @param {import('express').Response} res
   * @param {*}      data        Response payload (object, array, null)
   * @param {object} [meta]      Optional metadata (pagination, timing, etc.)
   * @param {number} [status]    Override HTTP status (default 200)
   */
  ok(res, data = null, meta = null, status = 200) {
    const body = { success: true };
    if (data !== null && data !== undefined) body.data = data;
    if (meta !== null && meta !== undefined) body.meta = meta;
    return res.status(status).json(body);
  },

  /**
   * 201 Created — resource successfully created
   */
  created(res, data = null, meta = null) {
    return respond.ok(res, data, meta, 201);
  },

  /**
   * 204 No Content — success with no response body
   * Used for DELETE and mark-as-read operations.
   */
  noContent(res) {
    return res.status(204).send();
  },

  /**
   * Paginated list response
   *
   * Automatically computes hasMore so the client knows
   * whether to fetch the next page.
   *
   * @param {import('express').Response} res
   * @param {Array}  items
   * @param {object} opts
   * @param {number} [opts.total]   Total records matching the query
   * @param {number} [opts.limit]   Page size used
   * @param {number} [opts.offset]  Current offset
   */
  paginated(res, items, { total, limit, offset } = {}) {
    const resolvedLimit  = Number(limit)  || items.length;
    const resolvedOffset = Number(offset) || 0;
    const resolvedTotal  = total !== undefined ? Number(total) : items.length;

    return res.status(200).json({
      success: true,
      data: items,
      meta: {
        total:   resolvedTotal,
        limit:   resolvedLimit,
        offset:  resolvedOffset,
        count:   items.length,
        hasMore: resolvedOffset + items.length < resolvedTotal,
      },
    });
  },

  /**
   * Error response — called exclusively by the global error handler
   * and auth middleware.
   *
   * @param {import('express').Response} res
   * @param {number}   statusCode   HTTP status
   * @param {string}   errorCode    Machine-readable string (for client switch)
   * @param {string}   message      Human-readable description
   * @param {*}        [details]    Optional extra info (validation errors array)
   */
  error(res, statusCode, errorCode, message, details = null) {
    const body = {
      success: false,
      error: {
        code:    errorCode,
        message,
        ...(details !== null && { details }),
      },
    };
    return res.status(statusCode).json(body);
  },
};

module.exports = respond;
