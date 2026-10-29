#!/usr/bin/env python3
"""Offline source coverage and audit classification tests (standard library only)."""
import json
import unittest
from pathlib import Path
from audit_sources import classify, apply_audit

ROOT = Path(__file__).resolve().parent
# Independent inventory of 100 source headings from the two normal HTML pages.
# Deliberately fixed: removing a source or alternate must fail coverage.
EXPECTED = [('Cinema of the World',
  'https://rentry.org/megathread-movies-and-tv',
  'cinema-of-the-world',
  ['https://worldscinema.org/']),
 ('rarefilmm', 'https://rentry.org/megathread-movies-and-tv', 'rarefilmm', ['https://rarefilmm.com/']),
 ('AcerMovies', 'https://rentry.org/megathread-movies-and-tv', 'acermovies', ['https://acermovies.fun/']),
 ('LIGHT DOWNLOADS', 'https://rentry.org/megathread-movies-and-tv', 'light-downloads', ['https://lightdl.xyz/']),
 ('Pahe', 'https://rentry.org/megathread-movies-and-tv', 'pahe', ['https://pahe.ink/']),
 ('PSArips', 'https://rentry.org/megathread-movies-and-tv', 'psarips', ['https://psa.wf/']),
 ('the movie channel',
  'https://rentry.org/megathread-movies-and-tv',
  'the-movie-channel',
  ['https://free-movies.to/']),
 ('TamilMV', 'https://rentry.org/megathread-movies-and-tv', 'tamilmv', ['https://1tamilmv.fi/']),
 ('Vegamovies', 'https://rentry.org/megathread-movies-and-tv', 'vegamovies', ['https://1vegamovies.cc/']),
 ('AnimeOut', 'https://rentry.org/megathread-movies-and-tv', 'animeout', ['https://www.animeout.xyz/']),
 ('AnimeOut', 'https://rentry.org/megathread-anime', 'animeout', ['https://www.animeout.xyz/']),
 ('Hi10 Anime',
  'https://rentry.org/megathread-movies-and-tv',
  'hi10-anime-sign-up-required',
  ['https://hi10anime.com/']),
 ('Hi10 Anime', 'https://rentry.org/megathread-anime', 'hi10-anime-sign-up-required', ['https://hi10anime.com/']),
 ('NoobSubs', 'https://rentry.org/megathread-movies-and-tv', 'noobsubs', ['https://www.noobsubs.com/']),
 ('NoobSubs', 'https://rentry.org/megathread-anime', 'noobsubs', ['https://www.noobsubs.com/']),
 ('Asiaflix',
  'https://rentry.org/megathread-movies-and-tv',
  'asiaflix-2-3-4',
  ['https://asiaflix.in/', 'https://asiaflix.net/', 'https://asiaflix.one/', 'https://asiaflix.xyz/']),
 ('kisskh', 'https://rentry.org/megathread-movies-and-tv', 'kisskh', ['https://kisskh.co/']),
 ('Dramaday', 'https://rentry.org/megathread-movies-and-tv', 'dramaday', ['https://dramaday.me/']),
 ('Einthusan', 'https://rentry.org/megathread-movies-and-tv', 'einthusan', ['https://einthusan.tv/']),
 ('MkvDrama', 'https://rentry.org/megathread-movies-and-tv', 'mkvdrama', ['https://mkvdrama.org/']),
 ('1Shows', 'https://rentry.org/megathread-movies-and-tv', '1shows', ['https://www.1shows.org/']),
 ('67movies', 'https://rentry.org/megathread-movies-and-tv', '67movies', ['https://67movies.net/']),
 ('HydraHD',
  'https://rentry.org/megathread-movies-and-tv',
  'hydrahd-alt',
  ['https://hydrahd.io/', 'https://hydrahd.info/']),
 ('Shiopa', 'https://rentry.org/megathread-movies-and-tv', 'shiopa', ['https://shiopa.com/']),
 ('SpenFlix', 'https://rentry.org/megathread-movies-and-tv', 'spenflix', ['https://watch.spencerdevs.xyz/']),
 ('Stellar', 'https://rentry.org/megathread-movies-and-tv', 'stellar', ['https://stellar.gdn/']),
 ('321Movies',
  'https://rentry.org/megathread-movies-and-tv',
  '321movies-alt',
  ['https://321movies.co.uk/', 'https://321movies.xyz']),
 ('7reels', 'https://rentry.org/megathread-movies-and-tv', '7reels', ['https://7reels.cc/']),
 ('Aether', 'https://rentry.org/megathread-movies-and-tv', 'aether', ['https://aether.cx']),
 ('ApexMovies', 'https://rentry.org/megathread-movies-and-tv', 'apexmovies', ['https://apexmovies.net']),
 ('Bcine', 'https://rentry.org/megathread-movies-and-tv', 'bcine', ['https://bcine.ru/']),
 ('Bingeflix', 'https://rentry.org/megathread-movies-and-tv', 'bingeflix', ['https://bingeflix.tv/']),
 ('Cinejoy', 'https://rentry.org/megathread-movies-and-tv', 'cinejoy', ['https://cinejoy.to/']),
 ('Cinema.bz', 'https://rentry.org/megathread-movies-and-tv', 'cinemabz', ['https://cinema.bz/']),
 ('CineWave', 'https://rentry.org/megathread-movies-and-tv', 'cinewave', ['https://watch.cinewave.qzz.io/']),
 ('Cinesu', 'https://rentry.org/megathread-movies-and-tv', 'cinesu', ['https://cine.su/']),
 ('Cinezo', 'https://rentry.org/megathread-movies-and-tv', 'cinezo', ['https://cinezo.net/']),
 ('CornClick', 'https://rentry.org/megathread-movies-and-tv', 'cornclick', ['https://cornclick.com/']),
 ('Dashflix', 'https://rentry.org/megathread-movies-and-tv', 'dashflix', ['https://dashflix.top/']),
 ('Donkey', 'https://rentry.org/megathread-movies-and-tv', 'donkey', ['https://donkey.to/']),
 ('Duafile', 'https://rentry.org/megathread-movies-and-tv', 'duafile', ['https://duafile.com/']),
 ('Filmex', 'https://rentry.org/megathread-movies-and-tv', 'filmex', ['https://filmex.to/']),
 ('FshareTV', 'https://rentry.org/megathread-movies-and-tv', 'fsharetv', ['https://fsharetv.co/']),
 ('Heartive', 'https://rentry.org/megathread-movies-and-tv', 'heartive', ['https://heartive.pages.dev/']),
 ('Huzske', 'https://rentry.org/megathread-movies-and-tv', 'huzske', ['https://huzske.com/']),
 ('Icefy', 'https://rentry.org/megathread-movies-and-tv', 'icefy', ['https://icefy.top/']),
 ('LatestMovies', 'https://rentry.org/megathread-movies-and-tv', 'latestmovies', ['https://latestmovies.net/']),
 ('LookMovie',
  'https://rentry.org/megathread-movies-and-tv',
  'lookmovie-mirrorlist',
  ['https://lookmovie2.to/', 'https://proxymirrorlookmovie.github.io/']),
 ('M-Zone', 'https://rentry.org/megathread-movies-and-tv', 'm-zone', ['https://m-zone.org/']),
 ('Mapple', 'https://rentry.org/megathread-movies-and-tv', 'mapple', ['https://mapple.tv/']),
 ('Beech.Watch', 'https://rentry.org/megathread-movies-and-tv', 'beechwatch', ['https://beech.watch/']),
 ('Movish', 'https://rentry.org/megathread-movies-and-tv', 'movish', ['https://movish.to/']),
 ('MusicBrainz.Tech',
  'https://rentry.org/megathread-movies-and-tv',
  'musicbrainztech',
  ['https://musicbrainz.tech']),
 ('PressPlay', 'https://rentry.org/megathread-movies-and-tv', 'pressplay', ['https://www.pressplay.top/']),
 ('ReelStream',
  'https://rentry.org/megathread-movies-and-tv',
  'reelstream-alt',
  ['https://rreelstream.live/', 'https://streamvaultsrc.click/']),
 ('Reelix', 'https://rentry.org/megathread-movies-and-tv', 'reelix', ['https://reelix.ac']),
 ('Redflix', 'https://rentry.org/megathread-movies-and-tv', 'redflix', ['https://redflix.one/']),
 ('Rive',
  'https://rentry.org/megathread-movies-and-tv',
  'rive-alt',
  ['https://www.rivestream.app/', 'https://rivestream.ru/']),
 ('Screenopps', 'https://rentry.org/megathread-movies-and-tv', 'screenopps', ['https://screenopps.com/']),
 ('Smashystream',
  'https://rentry.org/megathread-movies-and-tv',
  'smashystream-alt',
  ['https://smashystream.xyz/', 'https://flix.smashystream.xyz/']),
 ('UniqueStream', 'https://rentry.org/megathread-movies-and-tv', 'uniquestream', ['https://uniquestream.net/']),
 ('Vivarium', 'https://rentry.org/megathread-movies-and-tv', 'vivarium', ['https://vivarium.su/']),
 ('VidPlay', 'https://rentry.org/megathread-movies-and-tv', 'vidplay', ['https://vidplay.top/']),
 ('YesMovies', 'https://rentry.org/megathread-movies-and-tv', 'yesmovies', ['https://yesmovies.ag/']),
 ('YoYoMovies', 'https://rentry.org/megathread-movies-and-tv', 'yoyomovies', ['https://yoyomovies.net/']),
 ('Zstream', 'https://rentry.org/megathread-movies-and-tv', 'zstream', ['https://zstream.mov/']),
 ('EZTV',
  'https://rentry.org/megathread-movies-and-tv',
  'eztv-alt',
  ['https://eztvx.to/', 'https://eztvstatus.org/']),
 ('MSearch', 'https://rentry.org/megathread-movies-and-tv', 'msearch', ['https://msearch.vercel.app/']),
 ('1337x Movies',
  'https://rentry.org/megathread-movies-and-tv',
  '1337x-movies',
  ['https://1337x.to/movie-library/1/']),
 ('YTS', 'https://rentry.org/megathread-movies-and-tv', 'yts', ['https://yts.lt/']),
 ('LimeTorrents',
  'https://rentry.org/megathread-movies-and-tv',
  'limetorrents',
  ['https://www.limetorrents.lol/']),
 ('Anime Tosho', 'https://rentry.org/megathread-anime', 'anime-tosho', ['https://animetosho.org/']),
 ('Tokyo Insider', 'https://rentry.org/megathread-anime', 'tokyo-insider', ['https://www.tokyoinsider.com/']),
 ('Kayoanime', 'https://rentry.org/megathread-anime', 'kayoanime-google-group', ['https://kayoanime.com/']),
 ('ChauThanh', 'https://rentry.org/megathread-anime', 'chauthanh', ['https://chauthanh.info/']),
 ('AnimePahe', 'https://rentry.org/megathread-anime', 'animepahe', ['https://animepahe.pw/']),
 ('Miruro', 'https://rentry.org/megathread-anime', 'miruro', ['https://www.miruro.tv/']),
 ('Anidap', 'https://rentry.org/megathread-anime', 'anidap', ['https://anidap.se/']),
 ('AniHQ', 'https://rentry.org/megathread-anime', 'anihq', ['https://anihq.cc/']),
 ('Anikuro', 'https://rentry.org/megathread-anime', 'anikuro', ['https://anikuro.to/']),
 ('AnimeNana', 'https://rentry.org/megathread-anime', 'animenana', ['https://animenana.com/']),
 ('AnimeParadise', 'https://rentry.org/megathread-anime', 'animeparadise', ['https://www.animeparadise.moe/']),
 ('AnimeSilo', 'https://rentry.org/megathread-anime', 'animesilo', ['https://animesilo.cc/']),
 ('AnimeNoSub', 'https://rentry.org/megathread-anime', 'animenosub', ['https://animenosub.to/']),
 ('AniZone', 'https://rentry.org/megathread-anime', 'anizone', ['https://anizone.to/']),
 ('Re:Anime',
  'https://rentry.org/megathread-anime',
  'reanime-alt-alt',
  ['https://reanime.to/', 'https://reindex.to/', 'https://reanime.wtf/']),
 ('Flixer', 'https://rentry.org/megathread-anime', 'flixer', ['https://flixer.su/']),
 ('WcoFun', 'https://rentry.org/megathread-anime', 'wcofun-alt', ['https://wcofun.org/', 'https://www.wco.tv/']),
 ('123anime', 'https://rentry.org/megathread-anime', '123anime', ['https://123anime.info/']),
 ('Allwish', 'https://rentry.org/megathread-anime', 'allwish', ['https://all-wish.me/']),
 ('Yenime', 'https://rentry.org/megathread-anime', 'yenime', ['https://yenime.net/']),
 ('AnimeXin', 'https://rentry.org/megathread-anime', 'animexin-donghua-focus', ['https://animexin.vip/']),
 ('Myanime', 'https://rentry.org/megathread-anime', 'myanime-donghua-focus', ['https://myanime.live/']),
 ('Nyaa', 'https://rentry.org/megathread-anime', 'nyaa-alt', ['https://nyaa.si/', 'https://nyaa.land/']),
 ('SubsPlease', 'https://rentry.org/megathread-anime', 'subsplease', ['https://subsplease.org/']),
 ('Beatrice-Raws', 'https://rentry.org/megathread-anime', 'beatrice-raws', ['https://beatrice-raws.org/']),
 ('Drevos Index', 'https://rentry.org/megathread-anime', 'drevos-index', ['https://drevosindex.com/']),
 ('Erai-raws',
  'https://rentry.org/megathread-anime',
  'erai-raws-sign-up-required',
  ['https://www.erai-raws.info/']),
 ('Tokyo Toshokan',
  'https://rentry.org/megathread-anime',
  'tokyo-toshokan',
  ['https://www.tokyotosho.info/?cat=1']),
 ('Project AcgnX', 'https://rentry.org/megathread-anime', 'project-acgnx-chinese', ['https://share.acgnx.se/'])]

class SourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads((ROOT / 'sources.json').read_text())

    def test_complete_heading_coverage(self):
        actual = [(s['name'],p['page'],p['anchor'],p['listedUrls'])
                  for s in self.catalog['sources'] for p in s['provenance']]
        self.assertEqual(sorted(actual), sorted(EXPECTED))
        self.assertEqual(len(actual), 100)
        # Megathread sources plus the direct-download sites added on request (no megathread heading).
        self.assertEqual(len(self.catalog['sources']), 100)
        self.assertEqual({s['id'] for s in self.catalog['sources'] if not s['provenance']}, {'animetoki','anidl','animekaizoku'})
        self.assertTrue(all(s.get('openNavigation') for s in self.catalog['sources'] if not s['provenance']))
        self.assertEqual(len(self.catalog['excludedSources']), 27)

    def test_every_domain_audited_and_every_blocker_retained(self):
        urls = set()
        for source in self.catalog['sources']:
            expected = {source['url'], *source['alternateUrls']}
            urls.update(expected)
            self.assertEqual(expected, {p['url'] for p in source['audit']['probes']})
            self.assertEqual(source['audit']['level'], 'reachable-page')
            self.assertFalse(source['audit']['playbackTested'])
            self.assertTrue(source['reason'])
            self.assertIn(source['browseUrl'], expected)
            for p in source['provenance']:
                self.assertTrue(set(p['listedUrls']) <= expected)
            self.assertTrue(set(source['categories']) <= {'streaming','torrent','direct-download','drama'})
            self.assertTrue(set(source['kinds']) <= {'movies','anime'})
            if source['status'] in ('verification-wall','unavailable','unrelated'):
                self.assertEqual(source['mode'], 'unavailable')
            else:
                self.assertIn(source['mode'], ('site','native'))
        self.assertEqual(len(urls), 128)
        hydra = next(s for s in self.catalog['sources'] if s['nativeId'] == 'hydra')
        self.assertIn('https://hydrahd.gd/', hydra['alternateUrls'])
        self.assertEqual({s['nativeId'] for s in self.catalog['sources'] if s['nativeId']},
                         {'yts','hydra','anizone','nyaa','animetosho'})

    def test_captcha_detection_requires_wall_evidence(self):
        self.assertEqual(classify('<title>Catalog</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><h1>Movies</h1>')[0], 'reachable')
        self.assertEqual(classify('<script>captcha = true; verify you are human</script><p>Catalog</p>')[0], 'reachable')
        self.assertEqual(classify('<h1>Just a moment...</h1><p>Enable JavaScript and cookies to continue</p>', 403)[0], 'verification-wall')
        self.assertEqual(classify('<h1>Verify you are human</h1>')[0], 'verification-wall')
        self.assertEqual(classify('<p>Sorry, you have been blocked</p>', 403)[0], 'unavailable')
        self.assertEqual(classify('<h1>This domain is for sale</h1>')[0], 'unrelated')
        self.assertEqual(classify('<h1>Service discontinued</h1>')[0], 'unavailable')
        self.assertEqual(classify('<h1>Login required to download</h1>')[0], 'account-required')
        self.assertEqual(classify('<h1>Official mirrors</h1>', url='https://reindex.to/')[0], 'directory')

    def test_usable_alternate_selected(self):
        source = {'nativeId':None,'accountRequired':False}
        probes = [{'url':'https://blocked.invalid','status':'verification-wall','reason':'wall','checkedAt':'2026-10-29'},
                  {'url':'https://mirror.invalid','status':'reachable','reason':'Homepage only','checkedAt':'2026-10-29'}]
        apply_audit(source, probes)
        self.assertEqual(source['browseUrl'], 'https://mirror.invalid')
        self.assertEqual(source['mode'], 'site')
        self.assertFalse(source['audit']['playbackTested'])

if __name__ == '__main__': unittest.main()
