import json,unittest
import site_agent as a
class T(unittest.TestCase):
    def test_episode_names(self):
        self.assertEqual(a.file_episode('[Sub] Show - 05 (480p).mkv'),(None,5))
        self.assertEqual(a.file_episode('Show%20-%2007.mkv'),(None,7))
        self.assertEqual(a.file_episode('Show.S02E03.mkv'),(2,3))
        self.assertIsNone(a.file_episode('Movie - 1080p.mkv'))
    def test_only_right_episode(self):
        self.assertTrue(a.wants({'episode':5,'season':None},'Show - 05.mkv'))
        self.assertFalse(a.wants({'episode':5,'season':None},'Show - 06.mkv'))
    def test_final_name(self):
        j={'kind':'anime','title':'Show'};self.assertEqual(a.final_name(j,{'episode':2},'/x/[S] Show - 02 (1080p).mkv'),'Show - 02.mkv')
    def test_info_sites_are_hidden(self):
        c=[{'i':0,'label':'Show','href':'http://www.imdb.com/title/1','input':False},{'i':1,'label':'PD','href':'https://mirror.example/x','input':False}]
        self.assertEqual([x['i'] for x in a.ranked_controls(c,{'title':'Show'},{})],[1])
    def test_invented_controls_are_refused(self):
        with self.assertRaises(ValueError):a.valid_action(json.dumps({'action':'click','index':9}),[])
if __name__=='__main__':unittest.main()
