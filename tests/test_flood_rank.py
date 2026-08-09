import unittest

from scripts.fema_highest_hazard import flood_rank, select_highest


class FloodRankTests(unittest.TestCase):
    def test_floodway_precedes_minimal_x(self):
        minimal = {
            "FLD_ZONE": "X",
            "ZONE_SUBTY": "AREA OF MINIMAL FLOOD HAZARD",
            "SFHA_TF": "F",
        }
        floodway = {"FLD_ZONE": "AE", "ZONE_SUBTY": "FLOODWAY", "SFHA_TF": "T"}
        self.assertGreater(flood_rank(floodway), flood_rank(minimal))
        self.assertIs(select_highest([minimal, floodway]), floodway)

    def test_point_two_percent_precedes_minimal_x(self):
        minimal = {"FLD_ZONE": "X", "ZONE_SUBTY": "AREA OF MINIMAL FLOOD HAZARD"}
        point_two = {"FLD_ZONE": "X", "ZONE_SUBTY": "0.2 PCT ANNUAL CHANCE FLOOD HAZARD"}
        self.assertIs(select_highest([minimal, point_two]), point_two)

    def test_empty_collection_has_no_selection(self):
        self.assertIsNone(select_highest([]))


if __name__ == "__main__":
    unittest.main()
