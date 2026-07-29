/**
 * La bibliotheque personnelle doit survivre a « Nouveau reel ».
 *
 * C'est l'invariant qui justifie l'existence du magasin `library`: si le
 * ramasse-miettes ne comptait pas ses medias comme references, « Nouveau »
 * supprimerait leurs blobs et la bibliotheque n'afficherait que des cases vides
 * — exactement ce qu'elle est censee empecher.
 *
 * Le test tourne dans un vrai navigateur: IndexedDB ne se mocke pas utilement.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  addToLibrary,
  libraryMediaKeys,
  listLibrary,
  removeFromLibrary,
} from '@/storage/libraryStore';
import { collectGarbage, getMedia, putMedia } from '@/storage/mediaStore';
import { referencedMediaKeys, saveProject, deleteProject } from '@/storage/projectStore';
import { useLibraryStore } from '@/features/import/useLibrary';
import { createEmptyProject } from '@/domain/project';
import type { MediaAsset, Project } from '@/domain/types';

/** Vide la base entre deux tests: ils partagent le meme navigateur. */
async function resetStores(): Promise<void> {
  for (const asset of await listLibrary()) {
    await removeFromLibrary(asset.id);
  }
}

async function storeBlob(key: string, text: string) {
  return putMedia(key, new Blob([text], { type: 'image/png' }));
}

function assetFor(id: string, storage: Awaited<ReturnType<typeof storeBlob>>): MediaAsset {
  return {
    id,
    kind: 'image',
    name: `${id}.png`,
    mimeType: 'image/png',
    bytes: 16,
    storage,
    width: 10,
    height: 10,
    createdAt: Date.now(),
  };
}

describe('bibliotheque personnelle', () => {
  beforeEach(resetStores);

  it('conserve les medias ajoutes', async () => {
    const asset = assetFor('asset_lib1', await storeBlob('lib1.bin', 'un'));
    await addToLibrary(asset);

    const listed = await listLibrary();
    expect(listed.map((a) => a.id)).toContain('asset_lib1');
  });

  it('classe du plus recent au plus ancien', async () => {
    const older = {
      ...assetFor('asset_old', await storeBlob('old.bin', 'a')),
      createdAt: 1_000,
    };
    const newer = {
      ...assetFor('asset_new', await storeBlob('new.bin', 'b')),
      createdAt: 2_000,
    };
    await addToLibrary(older);
    await addToLibrary(newer);

    const listed = await listLibrary();
    // La pellicule montre les derniers imports en premier.
    expect(listed[0]!.id).toBe('asset_new');
  });

  it('compte ses medias comme references par le ramasse-miettes', async () => {
    const asset = assetFor('asset_ref', await storeBlob('ref.bin', 'c'));
    await addToLibrary(asset);

    const keys = await referencedMediaKeys();
    expect(keys).not.toBeNull();
    expect(keys!.has(asset.storage.key)).toBe(true);
  });

  it('survit a la suppression du projet et au ramasse-miettes', async () => {
    // Un media de bibliotheque, et un media qui n'appartient qu'au projet.
    const kept = assetFor('asset_kept', await storeBlob('kept.bin', 'garde'));
    const temporary = assetFor('asset_tmp', await storeBlob('tmp.bin', 'jetable'));
    await addToLibrary(kept);

    let project: Project = createEmptyProject('A supprimer');
    project = {
      ...project,
      assets: { [kept.id]: kept, [temporary.id]: temporary },
    };
    await saveProject(project);

    // C'est la sequence de « Nouveau reel ».
    await deleteProject(project.id);
    await collectGarbage(await referencedMediaKeys());

    // Le media de bibliotheque a garde son blob...
    expect(await getMedia(kept.storage)).not.toBeNull();
    // ...tandis que celui qui n'appartenait qu'au projet a ete libere.
    expect(await getMedia(temporary.storage)).toBeNull();
  });

  it('libere le blob une fois retire de la bibliotheque', async () => {
    const asset = assetFor('asset_drop', await storeBlob('drop.bin', 'd'));
    await addToLibrary(asset);
    await removeFromLibrary(asset.id);

    await collectGarbage(await referencedMediaKeys());
    // Plus reference nulle part: le ramasse-miettes doit le recuperer.
    expect(await getMedia(asset.storage)).toBeNull();
  });

  it('ne renvoie jamais un ensemble vide par erreur', async () => {
    // `null` signifie "liste inconnue" et fait s'abstenir le ramasse-miettes.
    // Un ensemble vide, lui, autoriserait la suppression de TOUT.
    const keys = await libraryMediaKeys();
    expect(keys).not.toBeNull();
  });
});

describe('vidage de la bibliotheque', () => {
  beforeEach(resetStores);

  it('vide bien le STOCKAGE et pas seulement la liste affichee', async () => {
    /*
      Piege que ce test verrouille: `clear` capture la liste AVANT de vider
      l'etat. Lire les assets apres le `set` renverrait un tableau deja vide,
      aucune suppression ne partirait vers IndexedDB, et la bibliotheque
      reapparaitrait entiere au prochain chargement — un bug qui ne se voit pas
      dans la session en cours.
    */
    for (const id of ['a', 'b', 'c']) {
      await addToLibrary(assetFor(`asset_${id}`, await storeBlob(`${id}.bin`, id)));
    }
    expect(await listLibrary()).toHaveLength(3);

    useLibraryStore.setState({ assets: await listLibrary(), loaded: true });
    await useLibraryStore.getState().clear();

    expect(useLibraryStore.getState().assets).toHaveLength(0);
    expect(await listLibrary()).toHaveLength(0);
  });

  it('laisse intact un media deja pose dans un montage', async () => {
    /*
      La propriete qui rend le bouton sur, et la raison pour laquelle on peut
      l'annoncer a l'utilisateur: vider la bibliotheque ne touche que des
      METADONNEES. Le blob reste partage, et le ramasse-miettes ne recupere que
      ce qu'aucun projet ne reference — un plan du montage protege donc le sien.
    */
    const asset = assetFor('asset_used', await storeBlob('used.bin', 'u'));
    await addToLibrary(asset);

    const project: Project = {
      ...createEmptyProject('Montage'),
      assets: { [asset.id]: asset },
    };
    await saveProject(project);

    useLibraryStore.setState({ assets: await listLibrary(), loaded: true });
    await useLibraryStore.getState().clear();
    await collectGarbage(await referencedMediaKeys());

    // Retire de la liste...
    expect(await listLibrary()).toHaveLength(0);
    // ...mais le blob survit, parce que le projet le reference encore.
    expect(await getMedia(asset.storage)).not.toBeNull();

    await deleteProject(project.id);
  });

  it('libere les blobs que plus rien ne reference', async () => {
    const asset = assetFor('asset_orphan', await storeBlob('orphan.bin', 'o'));
    await addToLibrary(asset);

    useLibraryStore.setState({ assets: await listLibrary(), loaded: true });
    await useLibraryStore.getState().clear();
    await collectGarbage(await referencedMediaKeys());

    expect(await getMedia(asset.storage)).toBeNull();
  });
});
