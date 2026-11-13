#!/usr/bin/env bash
# Vendored crates: vendor/<lib>/ is rebuilt from the crates.io packages that
# patches/<lib>/upstream.toml pins, with its drop list removed, the vendored
# crates depending on each other by path, and patches/<lib>/NNNN-*.patch
# applied in order. Nothing in vendor/<lib>/ is edited by hand without
# becoming a patch.
#
#   patches/vendor.sh sync    <lib>           rebuild vendor/<lib>/
#   patches/vendor.sh check   <lib>           fail unless vendor/<lib>/ is exactly that rebuild
#   patches/vendor.sh patch   <lib> <name>    record vendor/<lib>/'s edits as the next patch
#   patches/vendor.sh refresh <lib> <number>  fold vendor/<lib>/'s edits into that patch
#
# Downloaded packages are kept in build/crates/ and checked against the pin's
# checksums on every use.
set -euo pipefail

usage() {
	sed -n '8,11s/^# //p' "$0" >&2
	exit 2
}

root=$(cd "$(dirname "$0")/.." && pwd)
command=${1:-}
lib=${2:-}
[[ -n $command && -n $lib ]] || usage
pin=$root/patches/$lib/upstream.toml
vendor=$root/vendor/$lib
[[ -f $pin ]] || {
	echo "no pin at patches/$lib/upstream.toml" >&2
	exit 1
}

# A top-level `key = "value"` of the pin.
value() {
	awk -v key="$1" '/^\[/ { exit } $1 == key && $2 == "=" { gsub(/"/, "", $3); print $3 }' "$pin"
}

# `name checksum` for each package of the pin's [crates].
packages() {
	awk '/^\[/ { section = $0; next } section == "[crates]" && $2 == "=" { gsub(/"/, "", $3); print $1, $3 }' "$pin"
}

# `path checksum` for each repository file of the pin's [files].
files() {
	awk '/^\[/ { section = $0; next } section == "[files]" && $2 == "=" { gsub(/"/, ""); print $1, $3 }' "$pin"
}

# The globs of the pin's drop list.
drops() {
	awk '/^\[/ { section = $0; next }
		section == "[drop]" && /^[ \t]*"/ { sub(/^[ \t]*"/, ""); sub(/",?[ \t]*$/, ""); print }' "$pin"
}

# The patches, in the order they apply.
patches() {
	find "$root/patches/$lib" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]-*.patch' | sort
}

# A patch's number.
number() {
	local base
	base=$(basename "$1")
	echo $((10#${base:0:4}))
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# git apply and git diff --no-index act on plain directories here, never on
# a repository above the scratch directory.
export GIT_CEILING_DIRECTORIES=$work

# $1, downloaded from $2 into the cache once, checked against checksum $3.
fetch() {
	local file=$1 url=$2 checksum=$3 actual
	if [[ ! -f $file ]]; then
		mkdir -p "$(dirname "$file")"
		curl -fsSL --retry 3 -o "$file.part" "$url"
		mv "$file.part" "$file"
	fi
	if command -v sha256sum >/dev/null; then
		actual=$(sha256sum "$file" | cut -d' ' -f1)
	else
		actual=$(shasum -a 256 "$file" | cut -d' ' -f1)
	fi
	if [[ $actual != "$checksum" ]]; then
		echo "$url: checksum $actual, pinned $checksum" >&2
		exit 1
	fi
}

# The rebuild, into $1, with the patches numbered below $2 (all of them by
# default).
rebuild() {
	local out=$1 upto=${2:-10000} version commit raw name checksum path crate names
	version=$(value version)
	commit=$(value commit)
	mkdir -p "$out"
	while read -r name checksum; do
		crate=$root/build/crates/$name-$version.crate
		fetch "$crate" "https://static.crates.io/crates/$name/$name-$version.crate" "$checksum"
		tar -xzf "$crate" -C "$out"
		mv "$out/$name-$version" "$out/$name"
	done < <(packages)

	# A repository file comes from GitHub's raw view of the pinned commit.
	raw=$(value repository)
	raw=https://raw.githubusercontent.com/${raw#https://github.com/}/$commit
	while read -r path checksum; do
		fetch "$root/build/crates/$lib-$commit/$path" "$raw/$path" "$checksum"
		mkdir -p "$(dirname "$out/$path")"
		cp "$root/build/crates/$lib-$commit/$path" "$out/$path"
	done < <(files)

	(
		cd "$out"
		shopt -s nullglob dotglob
		while read -r glob; do
			# shellcheck disable=SC2086 # the glob expands here, on purpose
			rm -rf -- $glob
		done < <(drops)
	)

	# A vendored crate depends on another by path: a published manifest's
	# `[dependencies.<crate>]` table (and its dev-, build- and target-specific
	# forms) gains a `path` beside its `version`.
	names=$(packages | cut -d' ' -f1 | tr '\n' ' ')
	for manifest in "$out"/*/Cargo.toml; do
		awk -v names="$names" '
			BEGIN { n = split(names, list, " "); for (i = 1; i <= n; i++) vendored[list[i]] = 1 }
			{ print }
			/^\[(.*\.)?((build|dev)-)?dependencies\.[^]]+\]$/ {
				name = $0
				sub(/^.*dependencies\./, "", name)
				sub(/\]$/, "", name)
				if (name in vendored) print "path = \"../" name "\""
			}' "$manifest" >"$manifest.paths"
		mv "$manifest.paths" "$manifest"
	done

	if [[ -f $root/patches/$lib/README.md ]]; then
		cp "$root/patches/$lib/README.md" "$out/README.md"
	fi

	while read -r patch; do
		(($(number "$patch") < upto)) || continue
		if ! git -C "$out" apply --whitespace=nowarn "$patch"; then
			echo "${patch#"$root"/} does not apply" >&2
			exit 1
		fi
	done < <(patches)
}

# The diff from $work/a to $work/b, into $work/diff: refused when empty or
# when it deletes files.
diff_edits() {
	(cd "$work" && git diff --no-index --no-prefix --no-color --no-ext-diff --no-textconv --binary a b) >"$work/diff" || true
	if [[ ! -s $work/diff ]]; then
		echo "vendor/$lib has no edits beyond its patches" >&2
		exit 1
	fi
	if grep -q '^deleted file mode' "$work/diff"; then
		echo "vendor/$lib deletes files: remove them through the drop list in patches/$lib/upstream.toml instead" >&2
		exit 1
	fi
}

case $command in
sync)
	if [[ -d $vendor ]] && git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 &&
		[[ -n $(git -C "$root" status --porcelain -- "vendor/$lib") ]]; then
		echo "vendor/$lib has uncommitted changes: record them (patches/vendor.sh patch $lib <name>) or discard them first" >&2
		exit 1
	fi
	rebuild "$work/$lib"
	rm -rf "$vendor"
	mkdir -p "$(dirname "$vendor")"
	mv "$work/$lib" "$vendor"
	echo "vendor/$lib: $(packages | wc -l | tr -d ' ') crates at $(value version), $(patches | wc -l | tr -d ' ') patches"
	;;
check)
	rebuild "$work/$lib"
	if ! diff -r "$work/$lib" "$vendor" >"$work/differences"; then
		sed "s#$work/$lib#(rebuild)#g; s#$root/##g" "$work/differences" | head -40 >&2
		echo "vendor/$lib differs from its rebuild: record edits with patches/vendor.sh patch $lib <name>, or run patches/vendor.sh sync $lib" >&2
		exit 1
	fi
	;;
patch)
	name=${3:-}
	[[ $name =~ ^[a-z0-9][a-z0-9-]*$ ]] || {
		echo "name the patch in kebab-case, such as catalog-writer-decomposition-table" >&2
		exit 2
	}
	rebuild "$work/a"
	cp -R "$vendor" "$work/b"
	diff_edits
	last=$(patches | tail -1)
	next=$(printf '%04d' $((${last:+$(number "$last")} + 1)))
	file=$root/patches/$lib/$next-$name.patch
	{
		echo "From: $(git config user.name) <$(git config user.email)>"
		echo "Subject: [PATCH] ${name//-/ }"
		echo
		echo "What this changes in the vendored crates, and why."
		echo
		echo "Upstream: not proposed"
		echo "---"
		cat "$work/diff"
	} >"$file"
	echo "wrote ${file#"$root"/}: describe it in its header"
	;;
refresh)
	[[ ${3:-} =~ ^[0-9]+$ ]] || usage
	target=$(patches | while read -r patch; do if (($(number "$patch") == 10#$3)); then echo "$patch"; fi; done)
	[[ -n $target ]] || {
		echo "no patch $3 in patches/$lib" >&2
		exit 1
	}
	n=$(number "$target")
	rebuild "$work/a" "$n"
	# The vendored tree without the later patches, taken off last first.
	cp -R "$vendor" "$work/b"
	while read -r later; do
		if ! git -C "$work/b" apply -R --whitespace=nowarn "$later"; then
			echo "${later#"$root"/} does not come off vendor/$lib: the edits overlap it" >&2
			exit 1
		fi
	done < <(patches | while read -r patch; do if (($(number "$patch") > n)); then echo "$patch"; fi; done | sort -r)
	diff_edits
	# The header runs through the `---` line before the diff.
	{
		sed '/^---$/q' "$target"
		cat "$work/diff"
	} >"$work/refreshed"
	mv "$work/refreshed" "$target"
	echo "refreshed ${target#"$root"/}"
	;;
*)
	usage
	;;
esac
