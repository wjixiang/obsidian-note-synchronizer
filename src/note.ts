import { stringifyYaml, FrontMatterCache, TFile, EmbedCache } from 'obsidian';
import { NoteDigest, NoteTypeDigest } from './state';
import { MD5 } from 'object-hash';
import { Settings } from './setting';


const PICTURE_EXTENSION = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg'];
const VIDEO_EXTENSION = [
  'mp3',
  'wav',
  'm4a',
  'ogg',
  '3gp',
  'flac',
  'mp4',
  'ogv',
  'mov',
  'mkv',
  'webm'
];

export interface MediaNameMap {
  obsidian: string;
  anki: string;
}

export interface FrontMatter {
  mid: number;
  nid: number;
  tags: string[];
}

export default class Note {
  basename: string;
  folder: string;
  nid: number;
  mid: number;
  tags: string[];
  fields: Record<string, string>;
  typeName: string;
  extras: object;

  constructor(
    basename: string,
    folder: string,
    typeName: string,
    frontMatter: FrontMatter,
    fields: Record<string, string>
  ) {
    this.basename = basename;
    this.folder = folder;
    const { mid, nid, tags, ...extras } = frontMatter;
    this.typeName = typeName;
    this.mid = mid;
    this.nid = nid;
    this.tags = tags;
    this.extras = extras;
    this.fields = fields;
  }

  digest(): NoteDigest {
    return {
      deck: this.renderDeckName(),
      hash: MD5(this.fields),
      tags: this.tags
    };
  }

  title() {
    return this.basename;
  }

  renderDeckName() {
    return this.folder.replace(/\//g, '::') || 'Obsidian';
  }

  isCloze() {
    return this.typeName === '填空题' || this.typeName === 'Cloze';
  }
}

export class NoteManager {
  private settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  validateNote(
    file: TFile,
    frontmatter: FrontMatterCache,
    content: string,
    media: EmbedCache[] | undefined,
    noteTypes: Map<number, NoteTypeDigest>
  ): [Note | undefined, MediaNameMap[] | undefined] {
    if (
      !frontmatter.hasOwnProperty('mid') ||
      !frontmatter.hasOwnProperty('nid') ||
      !frontmatter.hasOwnProperty('tags')
    )
      return [undefined, undefined];
    const frontMatter = Object.assign({}, frontmatter, { position: undefined }) as FrontMatter;
    const lines = content.split('\n');
    const yamlEndIndex = lines.indexOf('---', 1);
    const body = lines.slice(yamlEndIndex + 1);
    const noteType = noteTypes.get(frontMatter.mid);
    if (!noteType) return [undefined, undefined];
    //remove media sync

    const frontmatterReg = /^---\n([\s\S]*?)\n---/;

    const [fields, mediaNameMap] = this.parseFields(file.basename, noteType, body, media,content.replace(frontmatterReg,""));
    console.log("remove frontmatter:",content.replace(frontmatterReg,""))


    //try to remove field check directly
    if (!fields) return [undefined, undefined]; 

    // now it is a valid Note
    const basename = file.basename;
    const folder = file.parent.path == '/' ? '' : file.parent.path;
    return [new Note(basename, folder, noteType.name, frontMatter, fields), mediaNameMap];
  }

  parseFields(
    title: string,
    noteType: NoteTypeDigest,
    body: string[],
    media: EmbedCache[] | undefined,
    fileContent:string
  ): [Record<string, string> | undefined, MediaNameMap[] | undefined] {
    const fieldNames = noteType.fieldNames;
    const headingLevel = this.settings.headingLevel;
    const isCloze = noteType.name === '填空题' || noteType.name === 'Cloze';
    let fieldContents: string[] = isCloze ? [] : [title];
    const mediaNameMap: MediaNameMap[] = [];
    let buffer: string[] = [];
    let mediaCount = 0;
    for (const line of body) {
      if (line.slice(0, headingLevel + 1) === '#'.repeat(headingLevel) + ' ') {
        fieldContents.push(buffer.join('\n'));
        buffer = [];
      } else {
        if (
          media &&
          mediaCount < media.length &&
          line.includes(media[mediaCount].original) &&
          this.validateMedia(media[mediaCount].link)
        ) {
          let mediaName = line.replace(
            media[mediaCount].original,
            media[mediaCount].link.split('/').pop() as string
          );
          if (this.isPicture(mediaName)) mediaName = '<img src="' + mediaName + '">';
          else mediaName = '[sound:' + mediaName + ']';
          if (!mediaNameMap.map(d => d.obsidian).includes(media[mediaCount].original)) {
            mediaNameMap.push({ obsidian: media[mediaCount].original, anki: mediaName });
            mediaCount++;
            buffer.push(mediaName);
          }
        } else {
          buffer.push(line);
        }
      }
    }
    fieldContents.push(buffer.join('\n'))
    fieldContents = [fieldContents[0],fileContent] 

    //hook
    if(title==="带状疱疹的临床表现"){
      console.log("带状疱疹的临床表现filedNames:",fieldNames)
      console.log("带状疱疹的临床表现fieldContents:",fieldContents)
    }

    if (fieldNames.length !== fieldContents.length) return [undefined, undefined];
    const fields: Record<string, string> = {};
    fieldNames.map((v, i) => (fields[v] = fieldContents[i]));
    return [fields, mediaNameMap];
  }

  validateMedia(mediaName: string) {
    return [...PICTURE_EXTENSION, ...VIDEO_EXTENSION].includes(
      mediaName.split('.').pop() as string
    );
  }

  isPicture(mediaName: string) {
    return PICTURE_EXTENSION.includes(mediaName.split('.').pop() as string);
  }

  dump(note: Note, mediaNameMap: MediaNameMap[] | undefined = undefined) {
    const frontMatter = stringifyYaml(
      Object.assign(
        {
          mid: note.mid,
          nid: note.nid,
          tags: note.tags
        },
        note.extras
      )
    )
      .trim()
      .replace(/"/g, ``);
    const fieldNames = Object.keys(note.fields);
    const lines = [`---`, frontMatter, `---`];
    if (note.isCloze()) {
      lines.push(note.fields[fieldNames[0]]);
      fieldNames.slice(1).map(s => {
        lines.push(`${'#'.repeat(this.settings.headingLevel)} ${s}`, note.fields[s]);
      });
    } else {
      lines.push(note.fields[fieldNames[1]]);
      fieldNames.slice(2).map(s => {
        lines.push(`${'#'.repeat(this.settings.headingLevel)} ${s}`, note.fields[s]);
      });
    }

    if (mediaNameMap)
      for (const i in lines)
        for (const mediaName of mediaNameMap)
          if (lines[i].includes(mediaName.anki))
            lines[i] = lines[i].replace(mediaName.anki, mediaName.obsidian);

    return lines.join('\n');
  }
}
