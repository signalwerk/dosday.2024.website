
rm -rf docs

npm run clear
npm run dl


mv DATA/html/dostag.ch docs
# copy the files to the docs foldern (including .dot files)
rsync -av --progress public/ docs


# -----------------------------------------
# copy original files to DATA
# -----------------------------------------

soure="docs"
destination="DATA/dostag.ch"

rm -rf "$destination"
mkdir -p "$destination"

destination=$(cd -- "$destination" && pwd) # make it an absolute path
cd -- "$source" &&
find "$soure" -type f -name "*.orig" -exec sh -c '

  dest_dir="${1#docs/}"
  dest_dir="$0/$dest_dir"
  dest_dir="${dest_dir%/*}"

  echo "$1 --- $dest_dir"
  mkdir -p "$dest_dir"
  mv "$1" "$dest_dir"

' "$destination" {} \;
# -----------------------------------------

rm -rf ./DATA/dl.log

# sort the log of downloaded files
jq -S '.' ./DATA/download.json > ./DATA/sorted_download.json
rm -rf ./DATA/download.json
mv ./DATA/sorted_download.json ./DATA/download.json

cp docs/Hauptseite.html docs/index.html