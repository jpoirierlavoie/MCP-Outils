from __future__ import annotations

import datetime as dt
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline.common.blue_green import swap_wrangler_binding
from pipeline.economie import ingest_economie
from pipeline.economie.ingest_economie import (
    CURRENCY_NAMES_FR,
    _parse_cpi_wds,
    _parse_statcan_cmhc,
    _parse_statcan_fx,
    _resolve_economie_binding_from_wrangler,
    _sample_statcan_payloads,
    build_local_sqlite,
    export_local_batches,
    incremental_fx_sync,
    sync_statcan_data,
    to_bps,
    to_milli,
    to_micros,
    to_rent_dollars,
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

    def test_currency_names_fr_includes_ang_and_skk(self) -> None:
        self.assertEqual(CURRENCY_NAMES_FR.get("ANG"), "Florin des Antilles néerlandaises")
        self.assertEqual(CURRENCY_NAMES_FR.get("SKK"), "Couronne slovaque")

    def test_resolve_economie_binding_blue_green_and_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            wrangler_copy = Path(tmp) / "wrangler.jsonc"
            wrangler_copy.write_text(
                json.dumps(
                    {
                        "d1_databases": [
                            {
                                "binding": "DB_ECONOMIE",
                                "database_name": "outils-economie",
                                "database_id": "00000000-0000-0000-0000-000000000000",
                            }
                        ]
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            self.assertEqual(
                _resolve_economie_binding_from_wrangler(None, wrangler_path=wrangler_copy),
                ("outils-economie", None),
            )

            swapped_uuid = "11111111-2222-3333-4444-555555555555"
            swap_wrangler_binding(
                "DB_ECONOMIE",
                "outils-economie-20261125",
                swapped_uuid,
                wrangler_path=wrangler_copy,
            )

            # Sans --db-name (None), la cible suit la bascule bleu-vert de wrangler.jsonc
            self.assertEqual(
                _resolve_economie_binding_from_wrangler(None, wrangler_path=wrangler_copy),
                ("outils-economie-20261125", swapped_uuid),
            )
            # Un --db-name différent ne doit jamais hériter du UUID de l'entrée basculée
            self.assertEqual(
                _resolve_economie_binding_from_wrangler(
                    "outils-economie", wrangler_path=wrangler_copy
                ),
                ("outils-economie", None),
            )
            # Un --db-name explicite identique conserve son UUID
            self.assertEqual(
                _resolve_economie_binding_from_wrangler(
                    "outils-economie-20261125", wrangler_path=wrangler_copy
                ),
                ("outils-economie-20261125", swapped_uuid),
            )

    def test_incremental_fx_sync_short_circuits_when_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            wrangler_copy = tmp_path / "wrangler.jsonc"
            swapped_uuid = "11111111-2222-3333-4444-555555555555"
            wrangler_copy.write_text(
                json.dumps(
                    {
                        "d1_databases": [
                            {
                                "binding": "DB_ECONOMIE",
                                "database_name": "outils-economie-20261125",
                                "database_id": swapped_uuid,
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            batch_dir = tmp_path / "batches"
            empty_payload = json.dumps({"seriesDetail": {}, "observations": []}).encode("utf-8")

            with (
                mock.patch.object(
                    ingest_economie, "_http_get_bytes", return_value=empty_payload
                ),
                mock.patch.object(ingest_economie, "d1_query_remote", return_value=[]),
                mock.patch.object(
                    ingest_economie, "execute_sql_files_remote"
                ) as mock_exec,
                mock.patch.object(
                    ingest_economie, "provision_or_get_d1"
                ) as mock_provision,
            ):
                res = incremental_fx_sync(
                    sample_only=False,
                    push_remote=True,
                    db_name=None,
                    batch_dir=batch_dir,
                    wrangler_path=wrangler_copy,
                )

            self.assertIsNone(res)
            mock_provision.assert_not_called()
            mock_exec.assert_not_called()
            tag = dt.date.today().strftime("%Y%m%d")
            self.assertFalse((batch_dir / f"incr_fx_{tag}.sql").exists())

            # Si --db-name diffère de wrangler.jsonc, provision_or_get_d1 résout l'UUID cible
            override_uuid = "99999999-8888-7777-6666-555555555555"
            with (
                mock.patch.object(
                    ingest_economie, "_http_get_bytes", return_value=empty_payload
                ),
                mock.patch.object(
                    ingest_economie,
                    "provision_or_get_d1",
                    return_value={"uuid": override_uuid},
                ) as mock_provision,
                mock.patch.object(
                    ingest_economie, "d1_query_remote", return_value=[]
                ) as mock_query,
                mock.patch.object(
                    ingest_economie, "execute_sql_files_remote"
                ) as mock_exec,
            ):
                res_override = incremental_fx_sync(
                    sample_only=False,
                    push_remote=True,
                    db_name="outils-economie",
                    batch_dir=batch_dir,
                    wrangler_path=wrangler_copy,
                )

            self.assertIsNone(res_override)
            mock_provision.assert_called_once_with("outils-economie", location="enam")
            self.assertTrue(
                all(call.args[0] == override_uuid for call in mock_query.call_args_list)
            )
            mock_exec.assert_not_called()

    def test_cpi_wds_skips_vector_id_zero_and_null_points(self) -> None:
        self.assertEqual(to_milli("168.4"), 168_400)
        self.assertEqual(to_milli(161.0), 161_000)
        with self.assertRaises(ValueError):
            to_milli("168.1234")

        codesets, cube_metas, series_infos, vector_datas, _, _ = _sample_statcan_payloads()
        series_rows, obs_rows, meta = _parse_cpi_wds(
            codesets, cube_metas, series_infos, vector_datas, require_all_mandatory=True
        )
        # 32 séries 2002=100 + 8 séries 1992=100 = 40 séries (les 8 vectorId=0 RMR rent/soins santé ignorés)
        self.assertEqual(len(series_rows), 40)
        geo_codes = {s["geo_code"] for s in series_rows}
        self.assertEqual(geo_codes, {"canada", "quebec", "quebec_rmr", "montreal_rmr"})

        # Vérifier absence de rent et health_care_services sur RMR
        rmr_products = {
            (s["geo_code"], s["product_code"])
            for s in series_rows
            if s["geo_code"] in {"quebec_rmr", "montreal_rmr"}
        }
        self.assertNotIn(("quebec_rmr", "rent"), rmr_products)
        self.assertNotIn(("montreal_rmr", "health_care_services"), rmr_products)

        # Vérifier UOM exacts (2002=100 vs 1992=100) et rejet de value=None (1978-08-01)
        uoms = {s["uom"] for s in series_rows}
        self.assertEqual(uoms, {"2002=100", "1992=100"})
        qc_m_all = next(
            s
            for s in series_rows
            if s["frequency"] == "M"
            and s["geo_code"] == "quebec"
            and s["product_code"] == "all_items"
            and s["uom"] == "2002=100"
        )
        qc_periods = [p for sid, p, _ in obs_rows if sid == qc_m_all["id"]]
        self.assertNotIn(197808, qc_periods)
        self.assertIn(202610, qc_periods)
        self.assertEqual(meta["M"]["version_date"], "2026-10-01")
        self.assertEqual(meta["A"]["version_date"], "2025-01-01")

    def test_cmhc_csv_skips_suppressed_and_normalizes_centres(self) -> None:
        self.assertEqual(to_rent_dollars("1346"), 1346)
        with self.assertRaises(ValueError):
            to_rent_dollars("1346.50")

        _, _, _, _, cmhc_meta, cmhc_zip_bytes = _sample_statcan_payloads()
        centres, rents, release_date = _parse_statcan_cmhc(cmhc_zip_bytes, cmhc_meta)
        self.assertEqual(release_date, "2025-12-17")
        by_id = {c["geo_member_id"]: c for c in centres}
        self.assertEqual(by_id[46]["search_norm"], "montreal")
        self.assertEqual(by_id[46]["is_quebec"], 1)
        self.assertEqual(by_id[48]["search_norm"], "quebec")
        self.assertEqual(by_id[37]["is_quebec"], 1)
        self.assertEqual(by_id[37]["province_code"], "QC")
        self.assertEqual(by_id[105]["is_quebec"], 0)
        self.assertEqual(by_id[105]["province_code"], "ON/QC")
        self.assertEqual(by_id[219]["search_norm"], "sainte sophie")
        self.assertEqual(by_id[203]["search_norm"], "saint lin laurentides")

        # Les cellules supprimées (48.2.1 STATUS=".." / VALUE="0" et 219.3.3 STATUS="F") doivent être absentes
        rent_keys = {(g, s, u, y) for g, s, u, y, _ in rents}
        self.assertNotIn((48, 2, 1, 2025), rent_keys)
        self.assertNotIn((48, 2, 1, 1987), rent_keys)
        self.assertNotIn((219, 3, 3, 2025), rent_keys)
        self.assertIn((219, 1, 3, 2025), rent_keys)
        self.assertIn((46, 3, 3, 2025), rent_keys)

    def test_sample_build_export_and_statcan_sync_e2e(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            work_dir = tmp_path / "work"
            batch_dir = tmp_path / "batches"

            db_path = build_local_sqlite(sample_only=True, work_dir=work_dir)
            conn = sqlite3.connect(db_path)
            conn.execute("PRAGMA query_only = ON;")
            cpi_cnt = conn.execute("SELECT COUNT(*) FROM cpi_series").fetchone()[0]
            obs_cnt = conn.execute("SELECT COUNT(*) FROM cpi_observations").fetchone()[0]
            cmhc_cnt = conn.execute("SELECT COUNT(*) FROM cmhc_centres").fetchone()[0]
            rent_cnt = conn.execute("SELECT COUNT(*) FROM cmhc_rents").fetchone()[0]
            meta_cnt = conn.execute("SELECT COUNT(*) FROM meta_sources").fetchone()[0]
            self.assertEqual(cpi_cnt, 40)
            self.assertGreater(obs_cnt, 80)
            self.assertEqual(cmhc_cnt, 6)
            self.assertEqual(rent_cnt, 8)
            self.assertEqual(meta_cnt, 7)
            conn.close()

            batch_files, counts = export_local_batches(db_path=db_path, batch_dir=batch_dir)
            self.assertEqual(counts["cpi_series"], 40)
            self.assertEqual(counts["cmhc_centres"], 6)
            self.assertEqual(counts["cmhc_rents"], 8)

            replay_db = tmp_path / "replay_statcan.db"
            rconn = sqlite3.connect(replay_db)
            try:
                rconn.execute("PRAGMA foreign_keys = ON;")
                for bf in batch_files:
                    raw_bytes = bf.read_bytes()
                    self.assertNotIn(b"\r\n", raw_bytes)
                    txt = raw_bytes.decode("utf-8")
                    self.assertNotIn("BEGIN", txt.upper())
                    self.assertNotIn("COMMIT", txt.upper())
                    rconn.executescript(txt)

                sync_file = sync_statcan_data(
                    sample_only=True,
                    push_remote=False,
                    db_path=db_path,
                    batch_dir=batch_dir,
                )
                self.assertIsNotNone(sync_file)
                sync_bytes = sync_file.read_bytes()
                self.assertNotIn(b"\r\n", sync_bytes)
                sync_txt = sync_bytes.decode("utf-8")
                self.assertIn("ON CONFLICT", sync_txt)
                rconn.executescript(sync_txt)

                # Idempotence : le nombre de séries et de loyers reste identique après rejeu
                self.assertEqual(
                    rconn.execute("SELECT COUNT(*) FROM cpi_series").fetchone()[0], 40
                )
                self.assertEqual(
                    rconn.execute("SELECT COUNT(*) FROM cmhc_rents").fetchone()[0], 8
                )
            finally:
                rconn.close()


if __name__ == "__main__":
    unittest.main()
