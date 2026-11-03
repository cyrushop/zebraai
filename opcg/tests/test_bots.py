"""Run: python3 -I opcg/tests/test_bots.py

Synthetic HTML only. The fixtures follow the layout the bots expect; they are
not copies of the live sites.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bot"))
import scrape_cards  # noqa: E402
import scrape_decks  # noqa: E402

CARDLIST = """
<html><body>
<form><select name="series" id="series">
  <option value="">全部</option>
  <option value="554110">擴充包【OP-10】</option>
  <option value="554108">擴充包【OP-08】</option>
  <option value="554201">額外補充包【EB-02】</option>
  <option value="554901">推廣卡</option>
</select></form>
<div class="resultCol">
<dl class="modalCol" id="OP08-001">
  <dt><div class="infoCol"><span>OP08-001</span> | <span>L</span> | <span>LEADER</span></div>
      <div class="cardName">托尼托尼・喬巴</div></dt>
  <dd><div class="frontCol"><img class="lazy" data-src="../images/cardlist/card/OP08-001.png?250101" src="data:image/gif;base64,R0"></div>
    <div class="backCol">
      <div class="col2"><div class="cost"><h3>生命</h3>4</div>
        <div class="attribute"><h3>屬性</h3><img src="x.png" alt="打"><i>打</i></div></div>
      <div class="col2"><div class="power"><h3>力量</h3>5000</div><div class="counter"><h3>反擊</h3>-</div></div>
      <div class="color"><h3>顏色</h3>紅/綠</div>
      <div class="feature"><h3>特徵</h3>動物/草帽一夥</div>
      <div class="text"><h3>效果</h3>【起動主要】【1回合1次】<br>效果第二行</div>
      <div class="getInfo"><h3>入手情報</h3>擴充包【OP-08】</div>
    </div></dd>
</dl>
<dl class="modalCol" id="OP08-002_p1">
  <dt><div class="infoCol"><span>OP08-002</span> | <span>SR</span> | <span>CHARACTER</span></div>
      <div class="cardName">卡路</div></dt>
  <dd><div class="frontCol"><img src="/images/cardlist/card/OP08-002_p1.png"></div>
    <div class="backCol">
      <div class="cost"><h3>費用</h3>3</div>
      <div class="power"><h3>力量</h3>4,000</div><div class="counter"><h3>反擊</h3>1000</div>
      <div class="color"><h3>顏色</h3>紅</div>
      <div class="trigger"><h3>觸發</h3>登場</div>
      <div class="getInfo"><h3>入手情報</h3>擴充包【OP-08】</div>
    </div></dd>
</dl>
<dl class="modalCol" id="notacard"><dt></dt></dl>
</div></body></html>
"""

DECK_INDEX = """
<html><body><h1>Deck List</h1>
<a href="/deck-list/japan-op-12-decks/">JP OP12</a>
<a href="https://onepiecetopdecks.com/deck-list/english-op-11/">EN OP11</a>
<a href="https://onepiecetopdecks.com/deck-list/">self</a>
<a href="https://other.example/deck-list/x">offsite</a>
<a href="/about/">about</a>
</body></html>
"""

DECK_PAGE = """
<html><body><h1>Japan OP-12 Decks</h1>
<table>
<tr><td>1st Place</td><td><a href="https://onepiecetopdecks.com/deckgen/?dn=Red%20Zoro&amp;au=Taro&amp;date=2026-10-01&amp;pl=1st&amp;dg=1nOP08-001a4nOP08-002a4nOP08-003a4nOP08-004a4nOP08-005a4nOP08-006">Red Zoro</a></td></tr>
<tr><td>Dup</td><td><a href="/deckgen/?dg=4nOP08-002a1nOP08-001a4nOP08-003a4nOP08-004a4nOP08-005a4nOP08-006">same</a></td></tr>
</table>
<h2>Blue Doffy (text list)</h2>
<p>1xOP10-002<br>4xOP10-010<br>4xOP10-011<br>4xOP10-012<br>4xOP10-013<br>4xOP10-014<br>4xOP10-015<br>
4xOP10-016<br>4xOP10-017<br>4xOP10-018<br>4xOP10-019<br>4xOP10-020<br>4xOP10-021<br>2xOP10-022</p>
<p>Other words</p>
</body></html>
"""


class CardBot(unittest.TestCase):
    def test_series(self):
        s = scrape_cards.parse_series(CARDLIST)
        self.assertEqual([x["value"] for x in s], ["554110", "554108", "554201", "554901"])
        self.assertEqual([x["code"] for x in s], ["OP10", "OP08", "EB02", ""])
        self.assertEqual([x["value"] for x in scrape_cards.pick_series(s, "op08,554201")], ["554108", "554201"])

    def test_cards(self):
        url = "https://asia-tc.onepiece-cardgame.com/cardlist/?series=554108"
        cards = scrape_cards.parse_cards(CARDLIST, url, {"value": "554108", "code": "OP08"})
        self.assertEqual([c["id"] for c in cards], ["OP08-001", "OP08-002_p1"])
        lead, char = cards
        self.assertEqual(lead["name"], "托尼托尼・喬巴")
        self.assertEqual(lead["category"], "LEADER")
        self.assertEqual(lead["life"], 4)
        self.assertIsNone(lead["cost"])
        self.assertEqual(lead["colors"], ["紅", "綠"])
        self.assertEqual(lead["image"], "https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP08-001.png?250101")
        self.assertIn("效果第二行", lead["text"])
        self.assertIn("\n", lead["text"])
        self.assertTrue(lead["attribute"].startswith("打"))
        self.assertEqual(lead["set"], "OP08")
        self.assertEqual(char["baseId"], "OP08-002")
        self.assertEqual(char["rarity"], "SR")
        self.assertEqual((char["cost"], char["power"], char["counter"]), (3, 4000, 1000))
        self.assertEqual(char["trigger"], "登場")
        self.assertEqual(char["image"], "https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP08-002_p1.png")


class DeckBot(unittest.TestCase):
    def test_links(self):
        links = scrape_decks.parse_links(DECK_INDEX, scrape_decks.START)
        self.assertEqual([l["url"] for l in links], [
            "https://onepiecetopdecks.com/deck-list/japan-op-12-decks/",
            "https://onepiecetopdecks.com/deck-list/english-op-11/",
        ])

    def test_decks(self):
        decks = scrape_decks.parse_decks(DECK_PAGE, "https://onepiecetopdecks.com/deck-list/japan-op-12-decks/")
        self.assertEqual(len(decks), 3)  # two links (same deck) + one text list
        a = decks[0]
        self.assertEqual(a["name"], "Red Zoro")
        self.assertEqual((a["author"], a["date"], a["placement"]), ("Taro", "2026-10-01", "1st"))
        self.assertEqual(a["entries"][0], {"id": "OP08-001", "count": 1})
        self.assertEqual(sum(e["count"] for e in a["entries"]), 21)
        self.assertEqual(scrape_decks.deck_key(a["entries"]), scrape_decks.deck_key(decks[1]["entries"]))
        t = decks[2]
        self.assertEqual(t["name"], "Blue Doffy (text list)")
        self.assertEqual(sum(e["count"] for e in t["entries"]), 51)
        self.assertEqual(scrape_decks._leader(t["entries"]), "OP10-002")


if __name__ == "__main__":
    unittest.main(verbosity=2)
