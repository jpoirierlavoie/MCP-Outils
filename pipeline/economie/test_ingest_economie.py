from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from pipeline.economie.ingest_economie import (
    _parse_statcan_fx,
    build_local_sqlite,
    export_local_batches,
    incremental_fx_sync,
    to_bps,
    to_micros,
)


class IngestEconomieTest(unittest.TestCase):
    def test_exact_decimal_conversions(self) -> None:
        self.assertEqual(to_micros("1.3435"), 1_343_500)
        self.assertEqual(to_micros("0.009145"), 9_145)
        self.assertEqual(to_bps("4.70"), 470)
        self.assertEqual(to_bps("0.25"), 25)
        with self.assertRaises(ValueError):
            to_micros("1.1234567")  # > 6 décimales
        with self.assertRaises(ValueError):
            to_micros("0")
        with self.assertRaises(ValueError):
            to_bps("4.705")  # > 2 décimales

    def test_statcan_skips_zero_weekend_rows(self) -> None:
        import io
        import zipfile

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(
                "10100008.csv",
                "REF_DATE,GEO,DGUID,Type of currency,UOM,UOM_ID,SCALAR_FACTOR,SCALAR_ID,VECTOR,COORDINATE,VALUE,STATUS,SYMBOL,TERMINATED,DECIMALS\n"
                "2001-01-06,Canada,,\"United States dollar, noon spot rate\",Dollars,81,units,0,v1,1.1,0.00000000,,,,4\n"
                "2001-01-08,Canada,,\"United States dollar, noon spot rate\",Dollars,81,units,0,v1,1.1,1.4980,,,,4\n",
            )
        ccys: dict[str, dict] = {}
        rates: dict[tuple[str, int, int], int] = {}
        count, max_d = _parse_statcan_fx(buf.getvalue(), ccys, rates)
        self.assertEqual(count, 1)
        self.assertEqual(max_d, "2001-01-08")
        self.assertEqual(rates, {("USD", 20010108, 1): 1_498_000})

    def test_sample_build_export_and_incremental_e2e(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            work_dir = tmp_path / "work"
            batch_dir = tmp_path / "batches"

            db_path = build_local_sqlite(sample_only=True, work_dir=work_dir)
            self.assertTrue(db_path.exists())
            self.assertLess(db_path.stat().st_size, 15 * 1024 * 1024)

            conn = sqlite3.connect(db_path)
            conn.execute("PRAGMA query_only = ON;")
            # IEXE0105 (USD_90D_FWD) et coordonnée 1.2 (forward) doivent être exclus
            # ARS 2010-01-04 doit prendre IEXE2703 (0.2734 -> 273400) plutôt que IEXE2702 (0.2690)
            ars_row = conn.execute(
                "SELECT r.rate_micros FROM fx_rates r "
                "JOIN fx_currencies c ON c.id = r.currency_id "
                "WHERE c.code = 'ARS' AND r.obs_date = 20100104 AND r.regime = 1"
            ).fetchone()
            self.assertEqual(ars_row, (273_400,))

            # Chevauchement 2017-01-03 : regime=1 (1.3438) ET regime=2 (1.3435) coexistent
            usd_2017 = conn.execute(
                "SELECT r.regime, r.rate_micros FROM fx_rates r "
                "JOIN fx_currencies c ON c.id = r.currency_id "
                "WHERE c.code = 'USD' AND r.obs_date = 20170103 ORDER BY r.regime"
            ).fetchall()
            self.assertEqual(usd_2017, [(1, 1_343_800), (2, 1_343_500)])

            # StatCan pré-euro FRF (2001-01-02 = 0.2145)
            frf_row = conn.execute(
                "SELECT r.rate_micros FROM fx_rates r "
                "JOIN fx_currencies c ON c.id = r.currency_id "
                "WHERE c.code = 'FRF' AND r.obs_date = 20010102 AND r.regime = 1"
            ).fetchone()
            self.assertEqual(frf_row, (214_500,))

            # V80691311 doit inclure la graine 2000-12-27 (750 bps)
            seed_prime = conn.execute(
                "SELECT rate_bps FROM boc_rates WHERE series_id = 'V80691311' AND obs_date = 20001227"
            ).fetchone()
            self.assertEqual(seed_prime, (750,))
            conn.close()

            # Export par lots : zéro BEGIN/COMMIT, LF uniquement, rejouable dans SQLite
            batch_files, counts = export_local_batches(db_path=db_path, batch_dir=batch_dir)
            self.assertGreaterEqual(len(batch_files), 6)
            self.assertGreater(counts["fx_rates"], 10)

            replay_db = tmp_path / "replay.db"
            rconn = sqlite3.connect(replay_db)
            try:
                rconn.execute("PRAGMA foreign_keys = ON;")
                for bf in batch_files:
                    raw_bytes = bf.read_bytes()
                    self.assertNotIn(b"\r\n", raw_bytes, f"CRLF trouvé dans {bf.name}")
                    txt = raw_bytes.decode("utf-8")
                    self.assertNotIn("BEGIN", txt.upper())
                    self.assertNotIn("COMMIT", txt.upper())
                    rconn.executescript(txt)

                # Appliquer ensuite la synchro incrémentale échantillon sur la base rejouée
                incr_file = incremental_fx_sync(
                    sample_only=True,
                    push_remote=False,
                    db_path=db_path,
                    batch_dir=batch_dir,
                )
                incr_bytes = incr_file.read_bytes()
                self.assertNotIn(b"\r\n", incr_bytes)
                incr_txt = incr_bytes.decode("utf-8")
                self.assertIn("ON CONFLICT", incr_txt)
                rconn.executescript(incr_txt)

                new_usd = rconn.execute(
                    "SELECT r.rate_micros FROM fx_rates r "
                    "JOIN fx_currencies c ON c.id = r.currency_id "
                    "WHERE c.code = 'USD' AND r.obs_date = 20261124 AND r.regime = 2"
                ).fetchone()
                self.assertEqual(new_usd, (1_399_100,))
            finally:
                rconn.close()


if __name__ == "__main__":
    unittest.main()
