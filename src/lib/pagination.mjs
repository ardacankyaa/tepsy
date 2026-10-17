export function paginate(rows, requestedPage = 1, requestedSize = 12) {
  const size = Math.max(1, Math.floor(Number(requestedSize) || 12));
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.max(1, Math.min(pageCount, Math.floor(Number(requestedPage) || 1)));
  const offset = (page - 1) * size;
  return {
    items: rows.slice(offset, offset + size),
    page,
    pageCount,
    total,
    start: total ? offset + 1 : 0,
    end: Math.min(total, offset + size),
  };
}
