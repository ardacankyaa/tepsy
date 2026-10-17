const MAX_PAGE_SIZE = 200;

function orderListPage(searchParams) {
  const requested = Number(searchParams.get("limit"));
  const take =
    Number.isSafeInteger(requested) && requested > 0
      ? Math.min(requested, MAX_PAGE_SIZE)
      : MAX_PAGE_SIZE;
  const cursor = searchParams.get("cursor");
  return cursor ? { take, cursor: { id: cursor }, skip: 1 } : { take };
}

module.exports = { orderListPage };
