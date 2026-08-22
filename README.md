# iptmusic.com

Deployment only. **Do not edit the pages here.**

They are generated in [SL-Collective/ipt](https://github.com/SL-Collective/ipt) by `make site`,
from `docs/privacy-policy.md`, `docs/terms.md` and `docs/refund-policy.md`, and a gate there
(`Tools/check_site_current.py`) rebuilds them into a temporary directory and compares bytes.

To publish a change: edit the documents in that repository, run `make site`, and copy
`site/` into `public/` here.

`/privacy` is the URL App Store Connect stores. `/terms`, `/refunds` and the pricing on the
landing page are what Stripe reads when it reviews the account.
