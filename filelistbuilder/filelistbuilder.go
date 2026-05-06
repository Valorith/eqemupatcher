//Super simple file list builder.
package main

import (
	"archive/zip"
	"bufio"
	"crypto/md5"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-yaml/yaml"
)

type Config struct {
	Client         string `yaml:"client,omitempty"`
	DownloadPrefix string `yaml:"downloadprefix,omitempty"`
}

type FileList struct {
	Version        string      `yaml:"version,omitempty"`
	Deletes        []FileEntry `yaml:"deletes,omitempty"`
	DownloadPrefix string      `yaml:"downloadprefix,omitempty"`
	Downloads      []FileEntry `yaml:"downloads,omitempty"`
	Unpacks        []FileEntry `yaml:"unpacks,omitempty"`
}

type FileEntry struct {
	Name string `yaml:"name,omitempty"`
	Md5  string `yaml:"md5,omitempty"`
	Date string `yaml:"date,omitempty"`
	Size int64  `yaml:"size,omitempty"`
}

var ignoreList []FileEntry

var fileList FileList
var patchFile *zip.Writer

func main() {
	var err error
	var out []byte

	inFile, err := ioutil.ReadFile("filelistbuilder.yml")
	if err != nil {
		log.Fatal("Failed to parse filelistbuilder.yml:", err.Error())
	}
	config := Config{}
	err = yaml.Unmarshal(inFile, &config)
	if err != nil {
		log.Fatal("Failed to unmarshal filelistbuilder.yml:", err.Error())
	}

	if len(config.Client) < 1 {
		log.Fatal("client not set in filelistbuilder.yml")
	}

	if len(config.DownloadPrefix) < 1 {
		log.Fatal("downloadprefix not set in filelistbuilder.yml")
	}
	fileList.DownloadPrefix = config.DownloadPrefix

	generateIgnores("ignore.txt")

	err = filepath.Walk(".", visit)
	if err != nil {
		log.Fatal("Error filepath", err.Error())
	}

	h := md5.New()
	io.WriteString(h, fmt.Sprintf("%d", time.Now().Nanosecond()))
	for _, d := range fileList.Downloads {
		io.WriteString(h, d.Name)
	}

	fileList.Version = fmt.Sprintf("%s%x", time.Now().Format("20060102"), h.Sum(nil))

	out, err = yaml.Marshal(&fileList)
	if err != nil {
		log.Fatal("Error marshalling:", err.Error())
	}
	if len(fileList.Downloads) == 0 {
		log.Fatal("No files found in directory")
	}

	ioutil.WriteFile("filelist_"+config.Client+".yml", out, 0644)

	//Now let's make patch zip.
	createPatch()

	log.Println("Wrote filelist_"+config.Client+".yml and patch.zip with", len(fileList.Downloads), "files inside.")

}

func createPatch() {
	var err error
	var f io.Writer
	var buf *os.File

	if buf, err = os.Create("patch.zip"); err != nil {
		log.Fatal("Failed to create patch.zip", err.Error())
	}

	patchFile = zip.NewWriter(buf)

	for _, download := range fileList.Downloads {
		var in io.Reader
		//fmt.Println("Adding", download.Name)
		if f, err = patchFile.Create(download.Name); err != nil {
			log.Fatal("Failed to create", download.Name, "inside patch:", err.Error())
		}

		if in, err = os.Open(download.Name); err != nil {
			log.Fatal("Failed to open", download.Name, "inside patch:", err.Error())
		}

		if _, err = io.Copy(f, in); err != nil {
			log.Fatal("Failed to copy", download.Name, "inside patch:", err.Error())
		}
	}

	//Now let's create a README.txt
	readme := "Extract the contents of patch.zip to your root EQ directory.\r\n"
	if len(fileList.Deletes) > 0 {
		readme += "Also delete the following files:\r\n"
		for _, del := range fileList.Deletes {
			readme += del.Name + "\r\n"
		}
	}
	if f, err = patchFile.Create("README.txt"); err != nil {
		log.Fatal("Failed to create README.txt inside patch:", err.Error())
	}

	f.Write([]byte(readme))

	if err = patchFile.Close(); err != nil {
		log.Fatal("Error while closing patchfile", err.Error())
	}

}

func visit(path string, f os.FileInfo, err error) error {
	if strings.Contains(path, "eqemupatcher.exe") ||
		strings.Contains(path, ".gitignore") ||
		strings.Contains(path, ".DS_Store") ||
		strings.Contains(path, "filelistbuilder") ||
		strings.Contains(path, "filelist") ||
		strings.Contains(path, "ignore.txt") ||
		path == "patch.zip" {
		return nil
	}

	if !f.IsDir() {

		for _, entry := range ignoreList {
			if path == entry.Name { //ignored file
				return nil
			}
		}
		//found a delete entry list
		if path == "delete.txt" {
			err = generateDeletes(path)

			//Don't conntinue.
			return nil
		}

		download := FileEntry{
			Size: f.Size(),
			Name: path,
			Date: f.ModTime().Format("20060102"),
		}
		var md5Val string
		if md5Val, err = getMd5(path); err != nil {
			log.Fatal("Failed to md5", path, err.Error())
		}
		download.Md5 = md5Val

		fileList.Downloads = append(fileList.Downloads, download)
	}
	return nil
}

func getMd5(path string) (value string, err error) {

	f, err := os.Open(path)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()

	h := md5.New()
	if _, err = io.Copy(h, f); err != nil {
		return
	}
	value = fmt.Sprintf("%x", h.Sum(nil))
	return
}

func generateIgnores(path string) (err error) {

	//if ignore doesn't exist, no worries.
	if _, err = os.Stat(path); os.IsNotExist(err) {
		err = nil
		return
	}

	file, err := os.Open(path)
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		data := scanner.Text()
		if len(data) == 0 {
			continue
		}
		if strings.Contains(data, "#") { //Strip comments
			data = data[0:strings.Index(data, "#")]
		}
		if len(strings.TrimSpace(data)) < 1 { //skip empty lines
			continue
		}

		entry := FileEntry{
			Name: data,
		}
		ignoreList = append(ignoreList, entry)
	}

	if err := scanner.Err(); err != nil {
		log.Fatal(err)
	}
	return
}

func generateDeletes(path string) (err error) {
	//if delete doesn't exist, no worries.
	if _, err = os.Stat(path); os.IsNotExist(err) {
		err = nil
		return
	}

	file, err := os.Open(path)
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		data := scanner.Text()
		if len(data) == 0 {
			continue
		}
		if strings.Contains(data, "#") { //Strip comments
			data = data[0:strings.Index(data, "#")]
		}
		if len(strings.TrimSpace(data)) < 1 { //skip empty lines
			continue
		}

		entry := FileEntry{
			Name: data,
		}

		fileList.Deletes = append(fileList.Deletes, entry)
	}

	if err := scanner.Err(); err != nil {
		log.Fatal(err)
	}
	return
}
