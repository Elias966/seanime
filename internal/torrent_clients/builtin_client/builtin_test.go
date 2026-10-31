package builtin_client

import (
	"context"
	"os"
	"path/filepath"
	"seanime/internal/database/db"
	"seanime/internal/database/models"
	"strings"
	"testing"

	anacrolix "github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"time"
)

const testMagnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Seanime%20Test"

func TestClientPersistsTorrentState(t *testing.T) {
	logger := zerolog.Nop()
	database, err := db.NewDatabase("", "seanime-test", &logger)
	require.NoError(t, err)

	newClient := func() *Client {
		client, clientErr := New(&NewClientOptions{
			Logger:             &logger,
			Database:           database,
			Dir:                t.TempDir(),
			Port:               -1,
			MaxActiveDownloads: 1,
			DisableNetwork:     true,
		})
		if clientErr != nil && strings.Contains(clientErr.Error(), "operation not permitted") {
			t.Skip("environment does not permit the torrent client's localhost listener")
		}
		require.NoError(t, clientErr)
		return client
	}

	client := newClient()
	torrent, err := client.AddMagnet(testMagnet, t.TempDir())
	require.NoError(t, err)
	hash := torrent.InfoHash().HexString()
	require.True(t, client.TorrentExists(hash))

	require.NoError(t, client.PauseTorrent(hash))
	require.NoError(t, client.SetSequential(hash, true))
	require.NoError(t, client.SetForceStart(hash, true))
	snapshots := client.Snapshots()
	require.Len(t, snapshots, 1)
	require.True(t, snapshots[0].ForceStart)
	require.True(t, snapshots[0].Sequential)
	require.False(t, snapshots[0].Paused)
	client.Close()

	restored := newClient()
	t.Cleanup(restored.Close)
	restoredSnapshots := restored.Snapshots()
	require.Len(t, restoredSnapshots, 1)
	require.Equal(t, hash, restoredSnapshots[0].Hash)
	require.True(t, restoredSnapshots[0].ForceStart)
	require.True(t, restoredSnapshots[0].Sequential)

	require.NoError(t, restored.RemoveTorrent(hash, false))
	require.Empty(t, restored.Snapshots())
	persisted, err := database.GetLocalTorrents()
	require.NoError(t, err)
	require.Empty(t, persisted)
}

func TestRemoveTorrentFallsBackToModelNameWhenRuntimeTorrentMissing(t *testing.T) {
	logger := zerolog.Nop()
	database, err := db.NewDatabase("", "seanime-test", &logger)
	require.NoError(t, err)

	destDir := t.TempDir()
	rootName := "fallback-folder"
	rootPath := filepath.Join(destDir, rootName)
	require.NoError(t, os.MkdirAll(filepath.Join(rootPath, "nested"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(rootPath, "nested", "episode.mkv"), []byte("hello"), 0644))

	hash := "0123456789abcdef0123456789abcdef01234567"
	item := &models.LocalTorrent{
		Hash:        hash,
		Name:        rootName,
		Destination: destDir,
	}
	require.NoError(t, database.UpsertLocalTorrent(item))

	client := &Client{
		logger:   &logger,
		database: database,
		torrents: map[string]*torrentEntry{
			hash: {model: item},
		},
	}

	require.NoError(t, client.RemoveTorrent(hash, true))
	_, err = os.Stat(rootPath)
	require.True(t, os.IsNotExist(err))

	persisted, err := database.GetLocalTorrents()
	require.NoError(t, err)
	require.Empty(t, persisted)
}

func TestTorrentRootFromModelRejectsEscapingName(t *testing.T) {
	destDir := t.TempDir()
	_, err := torrentRootFromModel(destDir, "../outside")
	require.Error(t, err)
}

func TestClassicStorageWritesHugeFileIncrementally(t *testing.T) {
	dir := t.TempDir()
	pc := storage.NewMapPieceCompletion()
	store := newClassicFileStorage(dir, pc)
	defer store.Close()

	info := &metainfo.Info{
		Name:        "huge-batch-file.mkv",
		Length:      8 << 30,
		PieceLength: 8 << 30,
		Pieces:      make([]byte, metainfo.HashSize),
	}
	torrent, err := store.OpenTorrent(context.Background(), info, metainfo.Hash{})
	require.NoError(t, err)

	piece := torrent.Piece(info.Piece(0))
	_, err = piece.WriteAt([]byte("test"), 0)
	require.NoError(t, err)

	path := filepath.Join(dir, "huge-batch-file.mkv")
	stat, err := os.Stat(path)
	require.NoError(t, err)
	require.EqualValues(t, 4, stat.Size())

	buf := make([]byte, 4)
	_, err = piece.ReadAt(buf, 0)
	require.NoError(t, err)
	require.Equal(t, "test", string(buf))
}

func TestRemovePausedTorrent(t *testing.T) {
	logger := zerolog.Nop()
	database, err := db.NewDatabase("", "seanime-test", &logger)
	require.NoError(t, err)

	client, err := New(&NewClientOptions{
		Logger:             &logger,
		Database:           database,
		Dir:                t.TempDir(),
		Port:               -1,
		MaxActiveDownloads: 1,
		DisableNetwork:     true,
	})
	if err != nil && strings.Contains(err.Error(), "operation not permitted") {
		t.Skip("environment does not permit the torrent client's localhost listener")
	}
	require.NoError(t, err)
	defer client.Close()

	destDir := t.TempDir()
	torrent, err := client.AddMagnet(testMagnet, destDir)
	require.NoError(t, err)
	hash := torrent.InfoHash().HexString()

	require.NoError(t, client.PauseTorrent(hash))
	snapshots := client.Snapshots()
	require.Len(t, snapshots, 1)
	require.True(t, snapshots[0].Paused)

	// Verify we can remove a paused torrent with deleteFiles = true
	err = client.RenameTorrent(hash, "test-paused-torrent-folder")
	require.NoError(t, err)

	// Create a mock folder
	mockFolderPath := filepath.Join(destDir, "test-paused-torrent-folder")
	err = os.MkdirAll(mockFolderPath, 0755)
	require.NoError(t, err)

	// Write a mock file
	mockFilePath := filepath.Join(mockFolderPath, "somefile.txt")
	err = os.WriteFile(mockFilePath, []byte("hello"), 0644)
	require.NoError(t, err)

	// Remove with deleteFiles = true
	require.NoError(t, client.RemoveTorrent(hash, true))
	require.Empty(t, client.Snapshots())

	// Verify files/folder are deleted
	_, err = os.Stat(mockFolderPath)
	require.True(t, os.IsNotExist(err))
}

func TestFinishedTorrentStopsSeeding(t *testing.T) {
	logger := zerolog.Nop()
	database, err := db.NewDatabase("", "seanime-test", &logger)
	require.NoError(t, err)

	// A local seeder with one small file
	seedDir := t.TempDir()
	content := make([]byte, 1<<20)
	require.NoError(t, os.WriteFile(filepath.Join(seedDir, "video.mkv"), content, 0o644))
	info := metainfo.Info{PieceLength: 1 << 16}
	require.NoError(t, info.BuildFromFilePath(filepath.Join(seedDir, "video.mkv")))
	infoBytes, err := bencode.Marshal(info)
	require.NoError(t, err)
	mi := metainfo.MetaInfo{InfoBytes: infoBytes}
	seedCfg := anacrolix.NewDefaultClientConfig()
	seedCfg.DataDir = seedDir
	seedCfg.Seed = true
	seedCfg.ListenPort = 0
	seedCfg.NoDHT = true
	seeder, err := anacrolix.NewClient(seedCfg)
	if err != nil && strings.Contains(err.Error(), "operation not permitted") {
		t.Skip("environment does not permit a localhost listener")
	}
	require.NoError(t, err)
	defer seeder.Close()
	seed, err := seeder.AddTorrent(&mi)
	require.NoError(t, err)
	require.True(t, seed.Seeding() || seed.BytesMissing() == 0)
	seed.VerifyData()

	client, err := New(&NewClientOptions{Logger: &logger, Database: database, Dir: t.TempDir(), Port: -1, MaxActiveDownloads: 1})
	require.NoError(t, err)
	defer client.Close()
	torrent, err := client.AddMagnet(mi.Magnet(nil, &info).String(), t.TempDir())
	require.NoError(t, err)
	hash := torrent.InfoHash().HexString()
	torrent.AddClientPeer(seeder)

	require.Eventually(t, func() bool {
		client.mu.RLock()
		defer client.mu.RUnlock()
		entry := client.torrents[hash]
		return entry != nil && entry.torrent == nil && entry.model.Paused
	}, 30*time.Second, 200*time.Millisecond, "the finished torrent should be stopped")
	require.Equal(t, int64(len(content)), client.torrents[hash].model.Completed)
}
